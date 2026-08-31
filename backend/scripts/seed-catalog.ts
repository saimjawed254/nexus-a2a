import { processAndUpsertProduct, RawProduct } from '../src/services/auto-vectorizer';
import { pool } from '../src/db/client';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const brands = ['Apple', 'Dell', 'Lenovo', 'ASUS', 'HP', 'Acer', 'Samsung', 'Microsoft', 'Razer', 'MSI'];
const laptopModels = ['Pro', 'Air', 'XPS', 'ThinkPad T14s', 'ROG Zephyrus', 'EliteBook', 'Aspire', 'Galaxy Book', 'Surface Pro', 'Blade 15'];
const monitorBrands = ['LG', 'Dell', 'Samsung', 'ASUS', 'BenQ', 'Acer', 'ViewSonic', 'AOC'];
const accessories = ['Mechanical Keyboard', 'Wireless Mouse', 'Webcam', 'Noise-Cancelling Headset', 'Laptop Stand', 'USB-C Hub', 'External SSD', 'Ergonomic Mousepad'];
const cpus = ['Intel Core i5-13500H', 'Intel Core i7-13700H', 'AMD Ryzen 7 7745HX', 'Apple M3 Pro', 'Intel Core i9-14900HK'];
const rams = ['8GB', '16GB', '32GB', '64GB'];
const storages = ['256GB SSD', '512GB SSD', '1TB SSD', '2TB SSD'];

const randomElement = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];
const randomNumber = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Exponential backoff retry wrapper
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 5, label = ''): Promise<T> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e: any) {
      if (e.status === 429) {
        const retryAfterMs = (attempt + 1) * 15000; // 15s, 30s, 45s, 60s, 75s
        console.log(`\n⏳ [${label}] Rate limited. Waiting ${retryAfterMs / 1000}s before retry ${attempt + 1}/${maxRetries}...`);
        await sleep(retryAfterMs);
      } else {
        throw e;
      }
    }
  }
  throw new Error(`Max retries exceeded for ${label}`);
}

function generateCatalog(): RawProduct[] {
  const products: RawProduct[] = [];

  // 40 Laptops - diverse, realistic specs
  for (let i = 0; i < 40; i++) {
    const brand = randomElement(brands);
    const model = randomElement(laptopModels);
    const cpu = randomElement(cpus);
    const ram = randomElement(rams);
    const storage = randomElement(storages);
    const screenSize = [13.3, 14, 15.6, 16, 17][randomNumber(0, 4)];
    const price = randomNumber(45000, 280000);
    const stock = randomNumber(5, 50);

    const hasSpecificRules = i % 4 === 0;
    const hasVolumeTier = i % 5 === 0;

    let rules: string | undefined;
    if (hasVolumeTier) {
      rules = `Maximum discount allowed is 12%. If buying 3 or more, max discount is 18%. If buying 10 or more, max discount is 22%.`;
    } else if (hasSpecificRules) {
      rules = `Max discount is 8% for this product. No exceptions.`;
    }

    products.push({
      name: `${brand} ${model} ${screenSize}" Laptop`,
      brand,
      model,
      category: 'Laptop',
      description: `The ${brand} ${model} is a premium ${screenSize}" laptop built for professionals and power users. Comes with a brilliant IPS display, all-day battery, and military-grade build quality. Great for heavy workloads, video editing, and development.`,
      specs: { CPU: cpu, RAM: ram, Storage: storage, Screen: `${screenSize}" IPS`, OS: 'Windows 11 Pro' },
      price,
      stock,
      unstructured_rules: rules
    });
  }

  // 30 Monitors - various sizes and resolutions
  for (let i = 0; i < 30; i++) {
    const brand = randomElement(monitorBrands);
    const sizeInches = [24, 27, 28, 32, 34][randomNumber(0, 4)];
    const resolution = ['Full HD 1080p', '2K QHD', '4K UHD', 'Ultra-Wide 3440x1440'][randomNumber(0, 3)];
    const refreshRate = [60, 75, 120, 144, 165, 240][randomNumber(0, 5)];
    const panel = ['IPS', 'VA', 'OLED', 'TN'][randomNumber(0, 3)];
    const price = randomNumber(12000, 95000);
    const stock = randomNumber(10, 100);

    products.push({
      name: `${brand} ${sizeInches}" ${resolution} ${panel} Monitor`,
      brand,
      model: `${brand}-M${sizeInches}-${resolution.replace(/\s/g, '')}`,
      category: 'Monitor',
      description: `The ${brand} ${sizeInches}" monitor features a stunning ${resolution} ${panel} panel with ${refreshRate}Hz refresh rate. Perfect for gaming, content creation, and professional work. Features HDMI, DisplayPort, and USB-C connectivity.`,
      specs: { 'Screen Size': `${sizeInches}"`, Resolution: resolution, 'Refresh Rate': `${refreshRate}Hz`, Panel: panel },
      price,
      stock,
      unstructured_rules: i % 3 === 0 ? `Strictly no more than 5% discount on monitors. Volume tier: 8% off for 5 or more.` : undefined
    });
  }

  // 30 Accessories
  for (let i = 0; i < 30; i++) {
    const type = randomElement(accessories);
    const brand = randomElement(['Logitech', 'Keychron', 'Razer', 'HyperX', 'Anker', 'SanDisk', 'Corsair', 'Jabra']);
    const price = randomNumber(1500, 20000);
    const stock = randomNumber(20, 200);

    products.push({
      name: `${brand} ${type}`,
      brand,
      model: `${brand.toUpperCase()}-${type.replace(/\s+/g, '-').toUpperCase()}-V${randomNumber(1, 5)}`,
      category: 'Accessory',
      description: `The ${brand} ${type} is a high-quality peripheral designed to enhance your workspace. Built with premium materials and backed by a 2-year warranty. Compatible with Windows, Mac, and Linux.`,
      specs: { Connectivity: randomNumber(0, 1) ? 'Wireless (2.4GHz + Bluetooth)' : 'USB-C', Warranty: '2 Years' },
      price,
      stock,
      unstructured_rules: `Volume pricing: 2% off for 2+, 5% off for 5+, 10% off for 10 or more units. Maximum overall discount cap is 15%.`
    });
  }

  return products;
}

async function seed() {
  console.log('🌱 Generating 100 diverse products...');
  const catalog = generateCatalog();

  const configRes = await pool.query('SELECT max_discount_pct FROM merchant_config LIMIT 1');
  let fallbackDiscount = 3.0;
  if (configRes.rows.length === 0) {
    await pool.query('INSERT INTO merchant_config (max_discount_pct) VALUES (3.0)');
  } else {
    fallbackDiscount = configRes.rows[0].max_discount_pct;
  }

  console.log(`🚀 Starting vectorization with retry logic. Fallback discount: ${fallbackDiscount}%`);
  console.log('⚠️  Rate limit is 20 req/min. Script will auto-retry on 429 errors with backoff.\n');

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < catalog.length; i++) {
    const product = catalog[i];
    try {
      await withRetry(
        () => processAndUpsertProduct(product, fallbackDiscount),
        6,
        `Product ${i + 1}/${catalog.length}: ${product.name}`
      );
      successCount++;
      process.stdout.write(`\r✅ Processed ${successCount}/${catalog.length} products.`);
      
      // Pacing: wait 3s between products to stay under 20 RPM
      // (each product = up to 2 Gemini calls: 1 embed + optionally 1 generateContent for rules)
      await sleep(3000);
    } catch (e: any) {
      console.error(`\n❌ Failed to process "${product.name}": ${e.message}`);
      failCount++;
    }
  }

  console.log(`\n\n🎉 Seeding complete! Success: ${successCount}, Failed: ${failCount}`);
  await pool.end();
}

seed();
