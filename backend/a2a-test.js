import 'dotenv/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import crypto from 'crypto';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
const API = 'http://localhost:4000';
const clerkUserId = 'user_demo_a2a_' + Date.now();

async function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function runA2ADemo() {
  console.log("🤖 [A2A Demo] Initializing Customer Agent...");
  
  // 0. Get a real product
  let productRes = await fetch(`${API}/api/discovery/discover`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: '' })
  });
  let productData = await productRes.json();
  const validProductId = productData.products[0].id;
  const cart = [{ product_id: validProductId, quantity: 2 }];
  console.log(`✅ [A2A Demo] Selected product for cart: ${productData.products[0].name}`);

  // 1. Start Negotiation
  let res = await fetch(`${API}/api/negotiation/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ buyer_type: 'AGENT', cart, clerk_user_id: clerkUserId })
  });
  let data = await res.json();
  
  if (!res.ok) {
    console.error("Failed to start session:", data);
    return;
  }
  
  const sessionId = data.session_id;
  console.log(`✅ [A2A Demo] Session Started: ${sessionId}`);

  // Fetch initial message
  res = await fetch(`${API}/api/negotiation/session/${sessionId}`);
  data = await res.json();
  let chatHistory = data.session.messages;
  let lastMessage = chatHistory[chatHistory.length - 1].content;
  
  console.log(`\n🏪 [Merchant AI]: ${lastMessage}`);

  // 2. Automated Negotiation Loop
  let status = 'ACTIVE';
  
  const customerAgentPrompt = `
    You are an aggressive but professional AI buying agent representing a customer.
    Your goal is to get the absolute lowest price possible for the items in the cart.
    Never accept the first offer. Threaten to walk away or buy from competitors if they don't lower the price.
    You must be concise. Do not use more than 3 sentences.
  `;
  
  const model = genAI.getGenerativeModel({ model: 'gemini-3.5-flash-lite' });
  const chat = model.startChat({
    history: [
      { role: 'user', parts: [{ text: customerAgentPrompt }] },
      { role: 'model', parts: [{ text: 'Understood. I will act as a ruthless but professional AI buying agent.' }] },
    ]
  });

  while (status === 'ACTIVE') {
    await delay(3000); // Respect rate limit
    
    // Generate Customer AI Response
    console.log("\n🤖 [Customer AI] Thinking...");
    const aiRes = await chat.sendMessage(`The Merchant AI just said: "${lastMessage}". Write your response to negotiate the price down further.`);
    const customerMsg = aiRes.response.text().trim();
    
    console.log(`🛒 [Customer AI]: ${customerMsg}`);
    
    // Send to Merchant
    res = await fetch(`${API}/api/negotiation/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-session-id': sessionId },
      body: JSON.stringify({ message: customerMsg })
    });
    
    if (res.status === 429) {
        console.log("Rate limited... waiting 2s");
        await delay(2000);
        continue;
    }

    data = await res.json();
    if (!res.ok) {
      console.error("Chat Error:", data);
      break;
    }
    
    lastMessage = data.reply;
    status = data.status;
    console.log(`\n🏪 [Merchant AI]: ${lastMessage}`);
    if (data.final_price) {
        console.log(`💰 Merchant's Final Offer: ₹${data.final_price}`);
    }

    if (status === 'PENDING_MERCHANT_REVIEW') {
      console.log("\n⏳ [A2A Demo] The AI agents reached a limit. The deal has been sent to the human merchant for manual review.");
      console.log("👉 Go to the Admin Dashboard to Approve or Reject the deal!");
      
      // Wait for human action
      while (status === 'PENDING_MERCHANT_REVIEW') {
        process.stdout.write(".");
        await delay(5000);
        const hr = await fetch(`${API}/api/negotiation/session/${sessionId}`);
        const hd = await hr.json();
        status = hd.session.status;
      }
      console.log("\n✅ [A2A Demo] Merchant has taken action!");
    }

    if (status === 'APPROVED') {
      console.log("\n🎉 [A2A Demo] Deal APPROVED! The Customer Agent is now processing payment...");
      
      // Create Order
      const cRes = await fetch(`${API}/api/checkout/create-order`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, customer_phone: '9999999999', shipping_address: 'A2A Agent Server' })
      });
      const orderData = await cRes.json();
      
      if (!cRes.ok) {
        console.error("Order Creation Failed:", orderData);
        break;
      }

      console.log(`💳 [A2A Demo] Order created: ${orderData.order_id} for ${orderData.amount / 100} INR. Completing payment...`);
      
      // Mock Razorpay Payment Success by generating a valid signature
      const mockPaymentId = 'pay_' + Date.now();
      const bodyStr = orderData.order_id + '|' + mockPaymentId;
      const expectedSignature = crypto
        .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        .update(bodyStr.toString())
        .digest('hex');

      const vRes = await fetch(`${API}/api/checkout/verify-payment`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          razorpay_order_id: orderData.order_id,
          razorpay_payment_id: mockPaymentId,
          razorpay_signature: expectedSignature,
          session_id: sessionId
        })
      });
      
      const vData = await vRes.json();
      if (vRes.ok) {
        console.log("✅🎉 [A2A Demo] PAYMENT SUCCESSFUL! Inventory deducted and deal fully completed via A2A automated checkout!");
      } else {
        console.error("Payment Verification Failed:", vData);
      }
      break;
    } else if (status === 'COMPLETED') {
      console.log("\n🎉 [A2A Demo] Deal Successfully Closed via A2A Negotiation!");
      break;
    } else if (status === 'TERMINATED') {
      console.log("\n❌ [A2A Demo] Negotiation Failed or Terminated.");
      break;
    }
  }
}

runA2ADemo();
