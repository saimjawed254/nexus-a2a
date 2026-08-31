import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../config/env';

const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);

// Use Gemini 3.5 Flash Lite for logic and parsing
export const geminiPro = genAI.getGenerativeModel({ model: "gemini-3.5-flash-lite" });

// Use embedding-001 for vector embeddings as fallback
export const geminiEmbed = genAI.getGenerativeModel({ model: "gemini-embedding-2" });

export async function generateEmbedding(text: string): Promise<number[]> {
  try {
    const result = await geminiEmbed.embedContent({
      content: { role: 'user', parts: [{ text }] },
      outputDimensionality: 768
    } as any);
    return result.embedding.values;
  } catch (error) {
    console.error("Embedding error:", error);
    throw new Error("Failed to generate embedding");
  }
}
