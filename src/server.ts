import { buildApp } from './app.ts';
import { openDatabase } from './db.ts';

const db = openDatabase(process.env.DATABASE_PATH ?? 'video-review.db');

const app = buildApp(db);
const port = Number(process.env.PORT ?? 3000);

app.listen({ port, host: '127.0.0.1' }).then((address) => {
  console.log(`ouvindo em ${address}`);
});
