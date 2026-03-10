import mongoose from "mongoose";

const unitSchema = new mongoose.Schema(
  {
    project: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Project",
      required: true,
    },
    block: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Block",
      required: true,
    },
    unit_number: { type: String, required: true },
    price: { type: Number, required: true },
    area_sqm: { type: Number, required: true },
    bedrooms: { type: Number, required: true },
    bathrooms: { type: Number, required: true },
    floor_number: Number,
    property_type: {
      type: String,
      enum: [
        "Apartment",
        "Villa",
        "Townhouse",
        "Penthouse",
        "Compound",
        "Chalet",
        "Twin House",
        "Duplex",
        "Full Floor",
        "Half Floor",
        "Whole Building",
        "Land",
        "Bulk Sale Unit",
        "Bulk Rent Unit",
        "Bungalow",
        "Hotel Apartment",
        "iVilla",
        "Studio",
      ],
      required: true,
    },
    status: {
      type: String,
      enum: ["available", "reserved", "sold"],
      default: "available",
    },
    images: [String],
    amenities: [String],
    agent: {
      name: String,
      phone: String,
      image: String,
    },
    description: String,
    view_type: String, // street, garden, park, sea, pool
    has_garden: { type: Boolean, default: false },
  },
  { timestamps: true },
);

// Compound index for better query performance
unitSchema.index({
  price: 1,
  bedrooms: 1,
  bathrooms: 1,
  property_type: 1,
  status: 1,
});

// Index for amenities search
unitSchema.index({ amenities: 1 });

// Index for area search
unitSchema.index({ area_sqm: 1 });

const Unit = mongoose.model("Unit", unitSchema);
export default Unit;
