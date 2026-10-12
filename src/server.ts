import { criarApp } from './app';
import { abrirBanco } from './banco';

const app = criarApp({ banco: abrirBanco(process.env.BANCO ?? 'video-review.db') });

app
  .listen({ port: Number(process.env.PORT ?? 3000), host: process.env.HOST ?? '127.0.0.1' })
  .then((endereco) => console.log(`API em ${endereco}`))
  .catch((erro) => {
    console.error(erro);
    process.exit(1);
  });
