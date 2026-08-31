import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../src/config/env';

async function test() {
  console.log("Using key:", env.GEMINI_API_KEY.substring(0, 10) + "...");
  
  // Test direct fetch to see models list
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${env.GEMINI_API_KEY}`);
    const data = await res.json();
    if (data.models) {
      console.log("Available models:");
      data.models.forEach((m: any) => console.log(m.name));
    } else {
      console.error("Failed to list models:", data);
    }
  } catch(e) {
    console.error("Fetch error:", e);
  }
}

test();
