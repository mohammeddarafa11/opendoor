import mongoose from "mongoose";

const blockSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Block name is required"],
      trim: true,
    },
    project: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Project",
      required: [true, "Project is required"],
    },
    total_floors: {
      type: Number,
      min: 1,
      max: 100,
    },
    units_per_floor: {
      type: Number,
      min: 1,
      max: 50,
    },
    description: {
      type: String,
      maxlength: 500,
    },
    status: {
      type: String,
      enum: ["under_construction", "ready", "fully_sold"],
      default: "under_construction",
    },
  },
  {
    timestamps: true,
  },
);

// Ensure unique block name per project
blockSchema.index({ name: 1, project: 1 }, { unique: true });

const Block = mongoose.model("Block", blockSchema);
export default Block;
