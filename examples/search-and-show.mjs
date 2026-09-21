// Search the Store and print the details of the top hit. Read-only: nothing is downloaded or installed.
//
//   node examples/search-and-show.mjs "windows terminal"
import { getProduct, searchStore } from 'ghostget';

const query = process.argv.slice(2).join(' ') || 'windows terminal';
const [best] = await searchStore(query, { limit: 5 });
if (!best) {
  console.error(`No apps found for "${query}".`);
  process.exit(3);
}

const app = await getProduct(best.id);
const price = app.price.free ? 'free' : app.price.free === false ? 'paid' : 'unknown';
console.log(`${app.name} [${app.id}] by ${app.publisher}`);
console.log(`price: ${price}, version: ${app.version ?? '?'}, delivery: ${app.delivery ?? '?'}`);
console.log(`installer: https://get.microsoft.com/installer/download/${app.id}`);
