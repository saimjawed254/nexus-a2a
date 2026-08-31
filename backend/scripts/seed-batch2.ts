import { processAndUpsertProduct, RawProduct } from '../src/services/auto-vectorizer';
import { pool } from '../src/db/client';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const brands = ['Apple', 'Dell', 'Lenovo', 'ASUS', 'HP', 'Acer', 'Samsung', 'Microsoft', 'Razer', 'MSI', 'LG', 'Sony'];
const cpus = ['Intel Core i5-13500H', 'Intel Core i7-13700H', 'AMD Ryzen 9 7945HX', 'Apple M3 Max', 'Intel Core i9-14900HK', 'AMD Ryzen 7 7745HX'];
const rams = ['8GB DDR5', '16GB DDR5', '32GB DDR5', '64GB DDR5'];
const storages = ['512GB NVMe SSD', '1TB NVMe SSD', '2TB NVMe SSD', '4TB NVMe SSD'];
const monitorBrands = ['LG', 'Dell', 'Samsung', 'ASUS', 'BenQ', 'Acer', 'ViewSonic', 'AOC', 'MSI'];
const phoneCategories = ['Flagship Smartphone', 'Budget Smartphone', 'Mid-range Smartphone'];
const phoneBrands = ['Apple', 'Samsung', 'OnePlus', 'Realme', 'Vivo', 'Oppo', 'Xiaomi'];
const tabletBrands = ['Apple', 'Samsung', 'Lenovo', 'Microsoft', 'Huawei'];
const printerBrands = ['HP', 'Canon', 'Epson', 'Brother', 'Lexmark'];
const accessories2 = ['Gaming Headset', 'RGB Mechanical Keyboard', 'Portable SSD 1TB', 'Wireless Charging Pad', 'Smart Webcam 4K', 'Thunderbolt Dock', 'Monitor Arm', 'Cable Management Kit'];

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

function generateBatch2(): RawProduct[] {
  const products: RawProduct[] = [];

  // 40 more laptops — different series/specs
  for (let i = 0; i < 40; i++) {
    const brand = randomElement(brands);
    const series = ['Spectre', 'Pavilion', 'VivoBook', 'ZenBook', 'IdeaPad', 'Yoga', 'Legion', 'Predator', 'Nitro', 'TUF'][i % 10];
    const cpu = randomElement(cpus);
    const ram = randomElement(rams);
    const storage = randomElement(storages);
    const screen = [13.3, 14, 15.6, 16, 17.3][randomNumber(0, 4)];
    const battery = [45, 65, 72, 86, 99][randomNumber(0, 4)];
    products.push({
      name: `${brand} ${series} ${screen}" Laptop 2026`,
      brand, model: series,
      category: 'Laptop',
      description: `The ${brand} ${series} 2026 edition features the ${cpu} processor with ${ram} RAM and ${storage}. Designed for professionals demanding extreme performance with a ${battery}Wh battery for all-day computing.`,
      specs: { CPU: cpu, RAM: ram, Storage: storage, Screen: `${screen}"`, Battery: `${battery}Wh`, GPU: 'NVIDIA RTX 4070' },
      price: randomNumber(60000, 320000),
      stock: randomNumber(3, 40),
      unstructured_rules: i % 3 === 0 ? `Max discount 10%. For 2+ units allow up to 15%. For 5+ units allow up to 20%.` : undefined
    });
  }

  // 25 smartphones
  for (let i = 0; i < 25; i++) {
    const brand = randomElement(phoneBrands);
    const category = randomElement(phoneCategories);
    const storage = ['128GB', '256GB', '512GB', '1TB'][randomNumber(0, 3)];
    const ram = ['8GB', '12GB', '16GB'][randomNumber(0, 2)];
    products.push({
      name: `${brand} ${category} ${storage}`,
      brand, model: `${brand.toUpperCase()}-${i + 1}`,
      category: 'Smartphone',
      description: `The ${brand} ${category} packs ${ram} RAM and ${storage} storage. Features a stunning AMOLED display, 5G connectivity, and a 50MP triple camera system for professional photography.`,
      specs: { RAM: ram, Storage: storage, Display: '6.7" AMOLED 120Hz', Camera: '50MP Triple', Battery: '5000mAh', Connectivity: '5G' },
      price: randomNumber(15000, 180000),
      stock: randomNumber(10, 80),
      unstructured_rules: i % 4 === 0 ? `Maximum discount is 6% for smartphones. Volume tier: 10% for 5+ units.` : undefined
    });
  }

  // 20 tablets
  for (let i = 0; i < 20; i++) {
    const brand = randomElement(tabletBrands);
    const size = [10.2, 10.9, 11, 12.4, 13, 13.3][randomNumber(0, 5)];
    products.push({
      name: `${brand} Tab ${size}" 2026`,
      brand, model: `Tab-${size}`,
      category: 'Tablet',
      description: `The ${brand} ${size}" tablet delivers a stunning display perfect for productivity, creativity, and entertainment. Supports optional keyboard and stylus for a full laptop-replacement experience.`,
      specs: { Screen: `${size}" LCD/OLED`, RAM: `${randomNumber(4, 16)}GB`, Storage: `${randomNumber(64, 512)}GB`, OS: brand === 'Apple' ? 'iPadOS 18' : 'Android 15' },
      price: randomNumber(25000, 150000),
      stock: randomNumber(5, 50),
      unstructured_rules: undefined
    });
  }

  // 15 printers/peripherals
  for (let i = 0; i < 15; i++) {
    const brand = randomElement(printerBrands);
    const type = ['All-in-One Colour Printer', 'Laser Printer', 'Photo Printer', 'Inkjet Printer'][randomNumber(0, 3)];
    products.push({
      name: `${brand} ${type} Pro`,
      brand, model: `${brand}-${type.replace(/\s+/g, '')}-${i}`,
      category: 'Printer',
      description: `The ${brand} ${type} Pro offers exceptional print quality at high speeds. Supports wireless printing, cloud integration, and comes with a 2-year warranty. Suitable for office and home use.`,
      specs: { Type: type, Speed: `${randomNumber(15, 40)}ppm`, Connectivity: 'Wi-Fi + USB', 'Paper Size': 'A4 / A3' },
      price: randomNumber(8000, 60000),
      stock: randomNumber(5, 30),
      unstructured_rules: i % 3 === 0 ? `Max 5% discount. Ink cartridges excluded from discount.` : undefined
    });
  }

  return products;
}

async function seedBatch2() {
  console.log('🌱 Generating batch 2 (100 more products: smartphones, tablets, printers, high-end laptops)...');
  const catalog = generateBatch2();

  const configRes = await pool.query('SELECT max_discount_pct FROM merchant_config LIMIT 1');
  const fallbackDiscount = configRes.rows.length > 0 ? configRes.rows[0].max_discount_pct : 3.0;

  console.log(`🚀 Starting vectorization with retry logic. Pacing: 3s between products.\n`);

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

  console.log(`\n\n🎉 Batch 2 complete! Success: ${successCount}, Failed: ${failCount}`);
  const totalRes = await pool.query('SELECT COUNT(*) FROM products');
  console.log(`📦 Total products in DB: ${totalRes.rows[0].count}`);
  await pool.end();
}

seedBatch2();
