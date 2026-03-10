import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import User from "../db/models/User.model.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const createUsers = async () => {
  try {
    if (!process.env.MONGO_URI) {
      throw new Error("MONGO_URI is not defined in .env");
    }

    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to MongoDB");

    // --- ADMIN ---
    const existingAdmin = await User.findOne({ role: "admin" });
    if (!existingAdmin) {
      const admin = await User.create({
        name: "Super Admin",
        email: "admin@example.com",
        password: "Admin@123",
        phone: "9999999999",
        role: "admin",
      });
      console.log("✅ Admin created:", admin.email);
    } else {
      console.log("Admin already exists:", existingAdmin.email);
    }

    // --- MANAGER ---
    const existingManager = await User.findOne({ role: "manager" });
    if (!existingManager) {
      const manager = await User.create({
        name: "Main Manager",
        email: "manager@example.com",
        password: "Manager@123",
        phone: "8888888888",
        role: "manager",
        sales_target: 100000, // optional
      });
      console.log("✅ Manager created:", manager.email);
    } else {
      console.log("Manager already exists:", existingManager.email);
    }

    process.exit();
  } catch (error) {
    console.error("❌ Error:", error.message);
    process.exit(1);
  }
};

createUsers();
