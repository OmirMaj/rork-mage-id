import { Hono } from "hono";
import { cors } from "hono/cors";

import emailRoute from "./routes/send-email";

const app = new Hono();

app.use("*", cors());

app.route("/email", emailRoute);

app.get("/", (c) => {
  return c.json({ status: "ok", message: "MAGE ID API is running" });
});

export default app;
