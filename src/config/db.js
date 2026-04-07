import mongoose from "mongoose";

const g = globalThis;

/**
 * Reuses Mongoose connection on Vercel (warm invocations) to avoid exhausting Atlas connections.
 */
const connectDB = async () => {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is not defined");
  }

  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  if (!g.__mongoConnectPromise) {
    g.__mongoConnectPromise = mongoose
      .connect(process.env.MONGO_URI)
      .then((m) => {
        console.log(`✅ MongoDB Connected: ${m.connection.host}`);
        return m.connection;
      });
  }

  try {
    await g.__mongoConnectPromise;
  } catch (error) {
    g.__mongoConnectPromise = null;
    console.error(`❌ Error: ${error.message}`);
    throw error;
  }

  return mongoose.connection;
};

export default connectDB;
