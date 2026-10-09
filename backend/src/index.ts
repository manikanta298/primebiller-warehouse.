import { createApp } from "./app.js";
import { config } from "./config.js";

createApp().listen(config.port, config.host, () => {
  console.log(`Girder API listening on :${config.port} (base path /api/v1)`);
});
