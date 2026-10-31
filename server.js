require("dotenv").config();

const app = require("./app");
const { connectDb } = require("./config/db");

const PORT = Number(process.env.PORT) || 5000;

connectDb();

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
