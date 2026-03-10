import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import User from "./src/db/models/User.model.js";

dotenv.config();

const createAdmin = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to DB");

    const email = "nassefasmaa6@gmail.com";
    const password = "Mohamed.arafa.2";
    const phone = "01010778266";

    // Clear existing user
    await User.deleteOne({ email });

    // Hash the password manually
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const user = new User({
      name: "Mohamed Arafa",
      email: email,
      phone: phone,
      password: hashedPassword,
      role: "customer",
      isVerified: true,
    });

    await user.save();
    console.log("✅ Custom User created successfully!");
    console.log(`Email: ${email}`);
    console.log(`Password: ${password}`);

    process.exit();
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
};

createAdmin();
