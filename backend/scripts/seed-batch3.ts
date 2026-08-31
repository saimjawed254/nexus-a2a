import { processAndUpsertProduct, RawProduct } from '../src/services/auto-vectorizer';
import { pool } from '../src/db/client';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const tvBrands = ['Sony', 'Samsung', 'LG', 'TCL', 'Hisense', 'Vizio'];
const smartwatchBrands = ['Apple', 'Samsung', 'Garmin', 'Fitbit', 'Amazfit'];
const audioBrands = ['Sony', 'Bose', 'Sennheiser', 'JBL', 'Bang & Olufsen'];
const cameraBrands = ['Canon', 'Nikon', 'Sony', 'Fujifilm', 'Panasonic'];

const randomElement = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];
const randomNumber = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 6, label = ''): Promise<T> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e: any) {
      if (e.status === 429) {
        const wait = (attempt + 1) * 15000;
        console.log(`\n⏳ [${label}] Rate limited. Waiting ${wait / 1000}s...`);
        await sleep(wait);
      } else throw e;
    }
  }
  throw new Error(`Max retries exceeded for ${label}`);
}

function generateBatch3(): RawProduct[] {
  const products: RawProduct[] = [];

  // 30 Smart TVs
  for (let i = 0; i < 30; i++) {
    const brand = randomElement(tvBrands);
    const size = [43, 50, 55, 65, 75, 85][randomNumber(0, 5)];
    const panel = ['OLED', 'QLED', 'Mini-LED', '4K LED'][randomNumber(0, 3)];
    products.push({
      name: `${brand} ${size}" ${panel} Smart TV`,
      brand, model: `${brand.toUpperCase()}-TV-${size}`,
      category: 'Television',
      description: `Experience breathtaking visuals with the ${brand} ${size}" ${panel} TV. Features HDR10+, Dolby Vision, and built-in smart capabilities for all your streaming apps.`,
      specs: { Size: `${size}"`, Panel: panel, Resolution: '4K Ultra HD', 'Smart OS': 'Android TV / webOS / Tizen' },
      price: randomNumber(25000, 350000),
      stock: randomNumber(5, 40),
      unstructured_rules: i % 4 === 0 ? `Max 10% discount on TVs. Buy 2 or more and get 15% off.` : undefined
    });
  }

  // 30 Smartwatches
  for (let i = 0; i < 30; i++) {
    const brand = randomElement(smartwatchBrands);
    products.push({
      name: `${brand} Smartwatch Series ${randomNumber(5, 10)}`,
      brand, model: `Watch-${randomNumber(5, 10)}`,
      category: 'Wearables',
      description: `The latest ${brand} Smartwatch tracks your fitness, monitors heart rate, and keeps you connected on the go. Swim-proof and features a vibrant OLED display.`,
      specs: { Battery: 'Up to 7 days', WaterResistance: '50m', Display: 'OLED Always-On' },
      price: randomNumber(10000, 80000),
      stock: randomNumber(20, 100),
      unstructured_rules: `Strictly no more than 8% discount on wearables.`
    });
  }

  // 20 Premium Audio
  for (let i = 0; i < 20; i++) {
    const brand = randomElement(audioBrands);
    const type = ['Noise Cancelling Headphones', 'True Wireless Earbuds', 'Bluetooth Speaker', 'Soundbar'][randomNumber(0, 3)];
    products.push({
      name: `${brand} ${type} Pro`,
      brand, model: `Audio-${i}`,
      category: 'Audio',
      description: `Immerse yourself in high-fidelity sound with the ${brand} ${type}. Features industry-leading active noise cancellation and premium build quality.`,
      specs: { Connectivity: 'Bluetooth 5.3', Battery: type.includes('Speaker') ? '24 Hours' : '30 Hours', ANC: 'Yes' },
      price: randomNumber(8000, 45000),
      stock: randomNumber(15, 60),
      unstructured_rules: undefined
    });
  }

  // 20 Cameras
  for (let i = 0; i < 20; i++) {
    const brand = randomElement(cameraBrands);
    const type = ['Mirrorless Camera', 'DSLR', 'Action Camera'][randomNumber(0, 2)];
    products.push({
      name: `${brand} ${type} Alpha-${randomNumber(1, 9)}`,
      brand, model: `Cam-${i}`,
      category: 'Camera',
      description: `Capture the world in stunning detail with this professional ${brand} ${type}. Features fast autofocus, 4K video recording, and weather sealing.`,
      specs: { Sensor: 'Full Frame / APS-C', Video: '4K 60fps / 8K 30fps', Mount: `${brand} Mount` },
      price: randomNumber(40000, 250000),
      stock: randomNumber(3, 20),
      unstructured_rules: i % 2 === 0 ? `Max discount 5%. High margin item.` : undefined
    });
  }

  return products;
}

async function seedBatch3() {
  console.log('🌱 Generating batch 3 (100 more products: TVs, Wearables, Audio, Cameras)...');
  const catalog = generateBatch3();

  const configRes = await pool.query('SELECT max_discount_pct FROM merchant_config LIMIT 1');
  const fallbackDiscount = configRes.rows.length > 0 ? configRes.rows[0].max_discount_pct : 3.0;

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < catalog.length; i++) {
    const product = catalog[i];
    try {
      await withRetry(
        () => processAndUpsertProduct(product, fallbackDiscount),
        6,
        `${i + 1}/${catalog.length}: ${product.name}`
      );
      successCount++;
      process.stdout.write(`\r✅ Processed ${successCount}/${catalog.length} products.`);
      await sleep(3000);
    } catch (e: any) {
      console.error(`\n❌ Failed "${product.name}": ${e.message}`);
      failCount++;
    }
  }

  console.log(`\n\n🎉 Batch 3 complete! Success: ${successCount}, Failed: ${failCount}`);
  const totalRes = await pool.query('SELECT COUNT(*) FROM products');
  console.log(`📦 Total products in DB: ${totalRes.rows[0].count}`);
  await pool.end();
}

seedBatch3();
