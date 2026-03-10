import mongoose from "mongoose";

const wishlistSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true, // Make it required
    },
    unit: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Unit",
      required: true,
    },
    notes: String,
  },
  { timestamps: true },
);

// CHANGE INDEX:
wishlistSchema.index({ user: 1, unit: 1 }, { unique: true });

export default mongoose.model("Wishlist", wishlistSchema);
