import mongoose from 'mongoose';

const courseSchema = new mongoose.Schema({
  title: { type: String, required: true },
  shortDescription: { type: String, required: true },
  longDescription: { type: String, required: true },
  imageUrl: { type: String, required: true },
  category: { type: String, required: true },
  deeplink: { type: String },
  videoUrl: { type: String },
  price: { type: mongoose.Schema.Types.Mixed, required: true },
});

const Course = mongoose.model('Course', courseSchema);

export default Course;
