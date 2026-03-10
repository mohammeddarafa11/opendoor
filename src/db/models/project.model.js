import mongoose from "mongoose";

const projectSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: String,

    // FIX THIS:
    location_name: String, // ADD THIS
    location: {
      type: { type: String, enum: ["Point"], default: "Point" },
      coordinates: {
        type: [Number], // [longitude, latitude]
        required: true,
        validate: {
          validator: function (v) {
            return (
              v.length === 2 &&
              v[0] >= -180 &&
              v[0] <= 180 && // longitude
              v[1] >= -90 &&
              v[1] <= 90
            ); // latitude
          },
          message: "Coordinates must be [longitude, latitude]",
        },
      },
      address: String,
      city: String,
    },

    images: [String],
    amenities: [String],
    total_units: { type: Number, default: 0 },
  },
  { timestamps: true },
);

projectSchema.index({ location: "2dsphere" });

const Project = mongoose.model("Project", projectSchema);
export default Project;
