import { createPushServer } from './server.mjs';
import { cloudConfig } from './cloud-config.mjs';

const config = cloudConfig(process.env);
const port = Number(process.env.PORT || 10000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT no es un puerto válido.');
const server = createPushServer(config);
server.listen(port, '0.0.0.0', () => console.log(`Explorador y API push escuchando en el puerto ${port}.`));
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => server.close());
}
