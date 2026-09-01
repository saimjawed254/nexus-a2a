import { Router, Request, Response } from 'express';
import { pool } from '../db/client';
import { geminiPro } from '../services/gemini';
import { SessionManager } from '../services/session-manager';
import { InventoryManager } from '../services/inventory-manager';
import { calculateCeiling } from '../services/constraint-solver';
import { sessionGuard } from '../middleware/session-guard';

export const negotiationRouter = Router();

negotiationRouter.get('/session/active', async (req: Request, res: Response) => {
  const clerk_user_id = req.query.clerk_user_id as string;
  if (!clerk_user_id) return res.status(400).json({ error: 'clerk_user_id required' });
  try {
    // Include APPROVED so the frontend can trigger the checkout flow after merchant approves
    const sessionRes = await pool.query(
      `SELECT * FROM sessions WHERE clerk_user_id = $1 AND status IN ('ACTIVE', 'PENDING_MERCHANT_REVIEW', 'APPROVED') ORDER BY created_at DESC LIMIT 1`,
      [clerk_user_id]
    );
    if (sessionRes.rows.length === 0) return res.json({ session: null });
    
    const session = sessionRes.rows[0];
    const messages = await SessionManager.getSessionMessages(session.id);
    
    // Get cart total and final price
    const cartRes = await pool.query('SELECT SUM(unit_price * quantity) as total FROM cart_items WHERE session_id = $1', [session.id]);
    const cartTotal = parseFloat(cartRes.rows[0].total || '0');
    
    const lastOffer = await pool.query(`
      SELECT metadata->>'finalOffer' as final_price FROM session_messages 
      WHERE session_id = $1 AND role = 'AGENT' AND metadata->>'finalOffer' IS NOT NULL 
      ORDER BY created_at DESC LIMIT 1
    `, [session.id]);
    const finalPrice = lastOffer.rows.length > 0 ? parseFloat(lastOffer.rows[0].final_price) : null;

    res.json({ session, messages, cartTotal, finalPrice });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

negotiationRouter.get('/sessions/user/:clerkUserId', async (req: Request, res: Response) => {
  const clerk_user_id = req.params.clerkUserId;
  try {
    const sessionRes = await pool.query(
      `SELECT id, status, terminated_reason, created_at, 
        (SELECT SUM(unit_price * quantity) FROM cart_items WHERE session_id = sessions.id) as cart_total 
       FROM sessions 
       WHERE clerk_user_id = $1 
       ORDER BY created_at DESC`,
      [clerk_user_id]
    );
    res.json({ sessions: sessionRes.rows });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

negotiationRouter.get('/session/:sessionId', async (req: Request, res: Response) => {
  try {
    const sessionId = req.params.sessionId as string;
    const sessionRes = await pool.query('SELECT * FROM sessions WHERE id = $1', [sessionId]);
    if (sessionRes.rows.length === 0) return res.status(404).json({ error: 'Session not found' });
    
    const messages = await SessionManager.getSessionMessages(sessionId);
    res.json({ session: { ...sessionRes.rows[0], messages } });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Simple in-memory rate limiter for chat (1 message per 2 seconds per session)
const chatRateLimit = new Map<string, number>();

negotiationRouter.post('/start', async (req: Request, res: Response) => {
  try {
    const { buyer_type, cart, clerk_user_id } = req.body;
    if (!cart || cart.length === 0) return res.status(400).json({ error: 'Cart is empty' });
    if (!clerk_user_id) return res.status(400).json({ error: 'clerk_user_id is required' });

    // Fetch config
    const configRes = await pool.query('SELECT session_timeout_minutes FROM merchant_config LIMIT 1');
    const timeout = configRes.rows.length > 0 ? configRes.rows[0].session_timeout_minutes : 15;

    // Terminate any existing active sessions for this user to prevent ghost sessions
    await pool.query(
      `UPDATE sessions SET status = 'TERMINATED', terminated_reason = 'SUPERSEDED' WHERE clerk_user_id = $1 AND status IN ('ACTIVE', 'PENDING_MERCHANT_REVIEW')`,
      [clerk_user_id]
    );

    // Create session
    const sessionId = await SessionManager.createSession(buyer_type || 'HUMAN', timeout, clerk_user_id);

    // Insert cart items first
    for (const item of cart) {
      const pRes = await pool.query('SELECT price FROM products WHERE id = $1', [item.product_id]);
      if (pRes.rows.length === 0) continue;
      await pool.query(
        'INSERT INTO cart_items (session_id, product_id, quantity, unit_price) VALUES ($1, $2, $3, $4)',
        [sessionId, item.product_id, item.quantity, pRes.rows[0].price]
      );
    }

    // Check availability (but don't allocate yet)
    try {
      await InventoryManager.checkAvailability(cart);
    } catch (e: any) {
      await SessionManager.terminateSession(sessionId, 'INSUFFICIENT_STOCK');
      let errorMsg = e.message;
      let outOfStockId = null;
      let isReserved = false;
      try { 
        const parsed = JSON.parse(e.message); 
        errorMsg = parsed.message; 
        outOfStockId = parsed.product_id; 
        isReserved = parsed.is_reserved;
      } catch (_) {}
      
      if (isReserved) {
        errorMsg = `We're sorry! Another customer has just reserved the last remaining units of this item and is currently in checkout. We have paused this negotiation. If they do not complete their payment soon, the stock will be released. Please try again in a few minutes.`;
      }
      return res.status(400).json({ error: errorMsg, out_of_stock_product_id: outOfStockId, is_reserved: isReserved });
    }

    // Generate an AI-powered welcome message based on the cart items and their rules
    let welcomeMsg = "Welcome! I can see your cart. What price are you targeting? I'll put together a breakdown for you.";
    try {
      const cartDetailsRes = await pool.query(`
        SELECT p.name, p.brand, p.category, p.unstructured_rules, ci.quantity, ci.unit_price
        FROM cart_items ci JOIN products p ON ci.product_id = p.id
        WHERE ci.session_id = $1
      `, [sessionId]);
      const configRes2 = await pool.query('SELECT max_discount_pct, llm_personality FROM merchant_config LIMIT 1');
      const config2 = configRes2.rows[0] || { max_discount_pct: 3, llm_personality: 'BALANCED' };

      if (cartDetailsRes.rows.length > 0) {
        const cartSummary = cartDetailsRes.rows.map((r: any) =>
          `- ${r.brand} ${r.name} x${r.quantity} @ ₹${r.unit_price} each` +
          (r.unstructured_rules ? ` [Rules: ${r.unstructured_rules}]` : '')
        ).join('\n');
        const cartTotal2 = cartDetailsRes.rows.reduce((s: number, r: any) => s + parseFloat(r.unit_price) * r.quantity, 0);

        const prompt = `You are a premium tech store AI sales agent. A customer has just started a negotiation session.
Your personality is: ${config2.llm_personality}.
The store's maximum discount policy is ${config2.max_discount_pct}%.

The customer's cart is:
${cartSummary}
Total cart value: ₹${cartTotal2.toFixed(0)}

Write a SHORT (3-4 sentence) personalized welcome message that:
1. Warmly greets them and acknowledges their specific items by name
2. Mentions the total cart value
3. Hints at possible offers based on the item rules (e.g. bulk/volume deals, bundle offers) WITHOUT revealing exact percentages
4. Invites them to make their opening offer or ask for your best price

Be professional, premium, and concise. Use Indian Rupee (₹) formatting.`;

        const result = await geminiPro.generateContent(prompt);
        const aiGreeting = result.response.text().trim();
        if (aiGreeting) welcomeMsg = aiGreeting;
      }
    } catch (greetErr) {
      console.error('AI greeting failed, using fallback:', greetErr);
    }

    await SessionManager.logMessage(sessionId, 'AGENT', welcomeMsg, {});

    res.json({ session_id: sessionId, status: 'ACTIVE' });
  } catch (error: any) {
    console.error("Start Session Error:", error);
    res.status(500).json({ error: 'Failed to start negotiation session' });
  }
});

// Customer self-terminate route — releases inventory immediately
negotiationRouter.post('/session/:sessionId/terminate', async (req: Request, res: Response) => {
  const sessionId = req.params.sessionId as string;
  const { clerk_user_id } = req.body;
  if (!clerk_user_id) return res.status(400).json({ error: 'clerk_user_id required' });
  try {
    const sRes = await pool.query('SELECT status, clerk_user_id FROM sessions WHERE id = $1', [sessionId]);
    if (sRes.rows.length === 0) return res.status(404).json({ error: 'Session not found' });
    if (sRes.rows[0].clerk_user_id !== clerk_user_id) return res.status(403).json({ error: 'Not your session' });
    if (['COMPLETED', 'TERMINATED'].includes(sRes.rows[0].status)) {
      return res.status(400).json({ error: `Session already ${sRes.rows[0].status}` });
    }
    await InventoryManager.releaseAllocation(sessionId);
    await SessionManager.terminateSession(sessionId, 'ABANDONED_BY_CUSTOMER');
    chatRateLimit.delete(sessionId);
    res.json({ success: true });
  } catch (err: any) {
    console.error("Customer Terminate Error:", err);
    res.status(500).json({ error: 'Failed to terminate session' });
  }
});

negotiationRouter.post('/session/:sessionId/cart', async (req: Request, res: Response) => {
  const sessionId = req.params.sessionId as string;
  const { cart } = req.body;

  if (!cart || cart.length === 0) return res.status(400).json({ error: 'Cart is empty' });

  try {
    // Verify session exists, is ACTIVE, and not expired
    const sRes = await pool.query('SELECT status, expires_at FROM sessions WHERE id = $1', [sessionId]);
    if (sRes.rows.length === 0) return res.status(404).json({ error: 'Session not found' });
    if (sRes.rows[0].status !== 'ACTIVE') return res.status(400).json({ error: 'Cannot update cart for non-active session' });
    if (new Date() > new Date(sRes.rows[0].expires_at)) {
      await SessionManager.terminateSession(sessionId, 'TIMEOUT');
      return res.status(400).json({ error: 'Session has expired. Please start a new negotiation.' });
    }

    // We don't need to release allocation because we only allocate upon approval now.
    // Just clear the old cart items.
    await pool.query('DELETE FROM cart_items WHERE session_id = $1', [sessionId]);

    // Insert new cart items
    let newCartTotal = 0;
    for (const item of cart) {
      const pRes = await pool.query('SELECT price FROM products WHERE id = $1', [item.product_id]);
      if (pRes.rows.length === 0) continue;
      const unitPrice = parseFloat(pRes.rows[0].price);
      newCartTotal += unitPrice * item.quantity;
      await pool.query(
        'INSERT INTO cart_items (session_id, product_id, quantity, unit_price) VALUES ($1, $2, $3, $4)',
        [sessionId, item.product_id, item.quantity, unitPrice]
      );
    }

    // Check availability of new items (no allocation yet)
    try {
      await InventoryManager.checkAvailability(cart);
    } catch (e: any) {
      await SessionManager.terminateSession(sessionId, 'INSUFFICIENT_STOCK');
      let errorMsg = e.message;
      let outOfStockId = null;
      let isReserved = false;
      try { 
        const parsed = JSON.parse(e.message); 
        errorMsg = parsed.message; 
        outOfStockId = parsed.product_id; 
        isReserved = parsed.is_reserved;
      } catch (_) {}
      
      if (isReserved) {
        errorMsg = `We're sorry! Another customer has just reserved the last remaining units of this item and is currently in checkout. We have paused this negotiation. If they do not complete their payment soon, the stock will be released. Please try again in a few minutes.`;
      }
      return res.status(400).json({ error: errorMsg, out_of_stock_product_id: outOfStockId, is_reserved: isReserved });
    }

    // Reset rounds but keep history
    await pool.query('UPDATE sessions SET rounds_used = 0 WHERE id = $1', [sessionId]);

    // Log system message
    await SessionManager.logMessage(sessionId, 'SYSTEM', `USER HAS UPDATED CART. New original cart value: ₹${newCartTotal.toLocaleString('en-IN')}. Rounds have been reset. Honor your previous promises and adjust the price accordingly based on the new cart.`);

    res.json({ success: true, message: 'Cart updated successfully', cart_total: newCartTotal });
  } catch (err: any) {
    console.error("Cart Update Error:", err);
    res.status(500).json({ error: 'Failed to update cart' });
  }
});


negotiationRouter.post('/chat', sessionGuard, async (req: Request, res: Response) => {
  const sessionId = req.headers['x-session-id'] as string;
  const { message } = req.body;
  const session = (req as any).session;

  // Rate limiting: 1 message per 2 seconds per session
  const lastMsgTime = chatRateLimit.get(sessionId) || 0;
  const now = Date.now();
  if (now - lastMsgTime < 2000) {
    return res.status(429).json({ error: 'Please wait a moment before sending another message.' });
  }
  chatRateLimit.set(sessionId, now);

  try {
    // Fetch Config & Check Rounds
    const configRes = await pool.query('SELECT max_rounds, llm_personality FROM merchant_config LIMIT 1');
    const config = configRes.rows.length > 0 ? configRes.rows[0] : { max_rounds: 3, llm_personality: 'STRICT' };

    if (session.rounds_used >= config.max_rounds) {
       return res.status(403).json({ error: 'Maximum negotiation rounds reached.' });
    }

    // Fetch Cart and Calculate Ceiling deterministically
    const cartRes = await pool.query('SELECT product_id, quantity FROM cart_items WHERE session_id = $1', [sessionId]);
    const { ceiling_amount, total_value } = await calculateCeiling(cartRes.rows);
    const minAcceptablePrice = total_value - ceiling_amount;

    // Fetch detailed cart names for the prompt
    const detailedCartRes = await pool.query(`
      SELECT p.name, p.price, p.unstructured_rules, c.quantity
      FROM cart_items c
      JOIN products p ON c.product_id = p.id
      WHERE c.session_id = $1
    `, [sessionId]);

    const cartContentsMarkdown = detailedCartRes.rows.map((item: any) => {
      const ruleText = item.unstructured_rules ? ` (Special Product Rule: ${item.unstructured_rules})` : '';
      return `- ${item.quantity}x ${item.name} (Original unit price: ₹${parseFloat(item.price).toLocaleString('en-IN')})${ruleText}`;
    }).join('\n');

    // Increment Round & Log User Message
    const currentRound = await SessionManager.incrementRound(sessionId);
    await SessionManager.logMessage(sessionId, 'USER', message);

    // Fetch Chat History
    const history = await SessionManager.getSessionMessages(sessionId);
    let historyText = history.map((msg: any) => `${msg.role}: ${msg.content}`).join('\n');

    // Construct Dynamic Prompt (Defense in Depth)
    const systemPrompt = `
You are a highly skilled ${config.llm_personality} sales negotiator for a premium tech store.
Your goal is to close the deal while maximizing profit. You are speaking directly to the customer.

CURRENT CART CONTENTS:
${cartContentsMarkdown}

MATHEMATICAL CONSTRAINTS (STRICTLY ENFORCED):
- Total Cart Original Value: ₹${total_value}
- Absolute Minimum Acceptable Price (Floor): ₹${minAcceptablePrice}
- The user cannot know the exact floor price early on. 
- You are currently on round ${currentRound} of ${config.max_rounds}.
- Do NOT offer the absolute minimum price on round 1. Start with a much smaller discount (e.g., 10-20% of the allowed ceiling).

BEHAVIORAL RULES:
1. UPSELLING & RULES: Proactively look at their cart and suggest add-ons or volume purchases. Your suggestions MUST BE EXTREMELY CLEAR, TRANSPARENT, AND SPECIFIC. Tell the user EXACTLY what item to add to their cart and EXACTLY what quantity to buy to qualify for a better deal. This must be STRICTLY based on the "Special Product Rule" attached to the items in the CURRENT CART CONTENTS. Explicitly quote or reference the rule you are using. Do NOT hallucinate random suggestions. Do NOT reveal the exact internal discount percentage, but make the requirement to unlock it crystal clear.
2. MANDATORY BREAKDOWNS: DO NOT ASK the customer if they want a breakdown. EVERY TIME you make an offer, you MUST provide a detailed line-item price breakdown formatted as a MARKDOWN TABLE. The table must have columns: Product, Original Price, Discount %, Discounted Price. Be completely transparent.
3. BOLDING: Use **bold markdown** when stating prices so they stand out.
4. CART UPDATES: If the chat history shows the user updated their cart to qualify for your upsell, you MUST acknowledge it. Offer them a significantly better percentage discount than your previous offers. Ensure your new total price is mathematically sound (usually higher than the old cart's total, but with a much better percentage discount).

If the user accepts your offer, or if this is the final round (${config.max_rounds}), you MUST output a final JSON block at the very end of your response indicating the final agreed price and if the deal is closed.

Format for closing/finalizing (ONLY include this if a deal is reached or you must give final offer):
\`\`\`json
{
  "deal_closed": boolean,
  "final_price": number
}
\`\`\`

--- START USER INPUT (SESSION ${sessionId}) ---
${message}
--- END USER INPUT (SESSION ${sessionId}) ---
`;

    // Call Gemini (with retry for 503 high demand)
    let response: any;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        response = await geminiPro.generateContent(systemPrompt + '\n\nChat History:\n' + historyText);
        break;
      } catch (err: any) {
        if (attempt === 3 || (!err.message?.includes('503') && !err.message?.includes('529'))) {
          throw err;
        }
        // Handle rate limiting / high demand with backoff
        await new Promise(r => setTimeout(r, 2000));
      }
    }
    const aiText = response.response.text();
    
    // Parse AI Output to check for JSON block
    let finalOffer: number | null = null;
    let dealClosed = false;
    let replyMessage = aiText;

    const jsonMatch = aiText.match(/\`\`\`json\s*([\s\S]*?)\s*\`\`\`/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        if (parsed.final_price && parsed.deal_closed !== undefined) {
           dealClosed = parsed.deal_closed;
           finalOffer = parsed.final_price;
           replyMessage = aiText.replace(jsonMatch[0], '').trim();
        }
      } catch (e) {
        console.error("AI JSON parsing failed", e);
      }
    }

    // Math Validation & Overrides (The core safety net)
    let systemDecision = "CONTINUE";

    // First validate any offer the AI made
    if (finalOffer !== null) {
      if (finalOffer < minAcceptablePrice) {
         console.warn(`[SAFETY] Engine overridden offer ₹${finalOffer}. Hard floor is ₹${minAcceptablePrice}. Overriding.`);
         finalOffer = minAcceptablePrice;
         replyMessage += `\n\n(System Note: The best possible price I can offer is ₹${finalOffer}.)`;
      }
    }
    
    // Independently enforce max rounds closure
    if (currentRound >= config.max_rounds && !dealClosed) {
      dealClosed = true;
      if (finalOffer === null) {
        finalOffer = minAcceptablePrice;
        replyMessage += `\n\nThis is my final offer: ₹${finalOffer}.`;
      }
      systemDecision = "MAX_ROUNDS_REACHED";
    }

    // If deal is closed (either by AI naturally or forced by max rounds), update status
    if (dealClosed) {
      const configRes2 = await pool.query('SELECT require_manual_approval FROM merchant_config LIMIT 1');
      const requireManual = configRes2.rows.length > 0 ? configRes2.rows[0].require_manual_approval : false;
      
      if (requireManual) {
        // Pending Review - Do NOT allocate stock yet
        await pool.query(`UPDATE sessions SET status = 'PENDING_MERCHANT_REVIEW' WHERE id = $1`, [sessionId]);
        if (systemDecision === "CONTINUE") systemDecision = "DEAL_CLOSED";
      } else {
        // Auto Approve - Attempt stock allocation NOW
        try {
          const cartRes2 = await pool.query('SELECT product_id, quantity FROM cart_items WHERE session_id = $1', [sessionId]);
          await InventoryManager.softAllocate(sessionId, cartRes2.rows);
          
          await pool.query(`UPDATE sessions SET status = 'APPROVED' WHERE id = $1`, [sessionId]);
          if (systemDecision === "CONTINUE") systemDecision = "DEAL_CLOSED";
        } catch (e: any) {
          // Stock ran out while chatting!
          dealClosed = false;
          finalOffer = null;
          let pName = 'an item';
          let isReserved = false;
          try { 
            const parsed = JSON.parse(e.message);
            pName = parsed.message.split(': ')[1] || pName; 
            isReserved = parsed.is_reserved;
          } catch (_) {}
          
          if (isReserved) {
            replyMessage += `\n\n**System Notice:** Another customer has just reserved the last remaining units of ${pName} and is currently in checkout. We have paused this negotiation. If they do not complete their payment soon, the stock will be released and we can resume.`;
            systemDecision = "RESERVED_DURING_CHAT";
          } else {
            replyMessage += `\n\n**System Notice:** Unfortunately, ${pName} just went out of stock while we were negotiating. We cannot finalize this deal right now.`;
            systemDecision = "OUT_OF_STOCK_DURING_CHAT";
          }
        }
      }
    }

    // Log AI response and System decision
    await SessionManager.logMessage(sessionId, 'AGENT', replyMessage, { finalOffer, dealClosed });
    await SessionManager.logMessage(sessionId, 'SYSTEM', `ROUND ${currentRound}/${config.max_rounds} EVALUATED`, { decision: systemDecision, forcedPrice: finalOffer });

    // Emit live events to merchant dashboard
    const io = (req as any).io;
    if (io) {
      io.to('merchant_monitor').emit('new_message', {
        session_id: sessionId,
        role: 'USER',
        content: message
      });
      io.to('merchant_monitor').emit('new_message', {
        session_id: sessionId,
        role: 'AGENT',
        content: replyMessage,
        metadata: { finalOffer, dealClosed, systemDecision }
      });
    }

    // Determine final status string to return
    let finalStatus = 'ACTIVE';
    if (dealClosed) {
      if (systemDecision === "OUT_OF_STOCK_DURING_CHAT" || systemDecision === "RESERVED_DURING_CHAT") {
        finalStatus = 'ACTIVE'; // They can still chat if they remove the item or wait
      } else {
        const sRes = await pool.query('SELECT status FROM sessions WHERE id = $1', [sessionId]);
        finalStatus = sRes.rows[0].status;
      }
    }

    res.json({
      reply: replyMessage,
      round: currentRound,
      max_rounds: config.max_rounds,
      status: finalStatus,
      final_price: finalOffer
    });

  } catch (error: any) {
    console.error("Negotiation Chat Error:", error);
    res.status(500).json({ error: 'Negotiation engine failed' });
  }
});

// User persistent cart endpoints
negotiationRouter.get('/user/:clerkUserId/cart', async (req: Request, res: Response) => {
  try {
    const result = await pool.query('SELECT cart_data FROM user_carts WHERE clerk_user_id = $1', [req.params.clerkUserId]);
    if (result.rows.length === 0) return res.json({ cart: [] });
    res.json({ cart: result.rows[0].cart_data });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

negotiationRouter.put('/user/:clerkUserId/cart', async (req: Request, res: Response) => {
  try {
    const { cart } = req.body;
    await pool.query(
      `INSERT INTO user_carts (clerk_user_id, cart_data, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (clerk_user_id) DO UPDATE SET cart_data = EXCLUDED.cart_data, updated_at = NOW()`,
      [req.params.clerkUserId, JSON.stringify(cart)]
    );
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});
