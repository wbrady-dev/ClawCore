import { startServer } from "./server.js";
import { logger } from "./utils/logger.js";

startServer().catch((err) => {
  logger.error(err, "Fatal error");
  process.exit(1);
});
