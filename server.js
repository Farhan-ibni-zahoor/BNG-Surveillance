// server.js

// 1. IMPORTS
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const cloudinary = require('cloudinary').v2;
const CloudinaryStorage = require('multer-storage-cloudinary');

// 2. CONFIGURATION
const app = express();
const PORT = process.env.PORT || 5000;

// 3. CLOUDINARY CONFIGURATION
// REPLACE THESE WITH YOUR KEYS FROM CLOUDINARY.COM DASHBOARD
// 3. CLOUDINARY CONFIGURATION (READS FROM ENV VARS)
cloudinary.config({ 
    cloud_name: process.env.CLOUD_NAME, 
    api_key: process.env.CLOUD_API_KEY, 
    api_secret: process.env.CLOUD_API_SECRET 
});

// 4. MONGOOSE & RAZORPAY
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID || 'rzp_test_S6anGX8BwOZEL8', 
    key_secret: process.env.RAZORPAY_KEY_SECRET || 'CHEK3LJgZHmCdhd2NyJg5DSf'
});

const DB_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/bng-surveillance';

// 5. MIDDLEWARE & CORS
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Serve frontend

// 6. DATABASE CONNECTION
mongoose.connect(DB_URI)
    .then(() => console.log("✅ MongoDB Connected (Atlas)"))
    .catch(err => console.error("❌ Database Connection Failed!", err));

// 7. SCHEMAS
const UserSchema = new mongoose.Schema({
    name: String,
    email: String,
    password: String,
    role: { type: String, default: 'customer' }
});

const ProductSchema = new mongoose.Schema({
    name: String,
    category: String,
    price: Number,
    image: String, // Will store full Cloudinary URL now
    desc: String,
    reviews: [{ user: String, comment: String, date: { type: Date, default: Date.now } }]
});

const OrderSchema = new mongoose.Schema({
    razorpay_order_id: String,
    payment_status: String,
    customer: String,
    email: String,
    phone: String,
    address: String,
    items: Array,
    total: Number,
    date: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const Product = mongoose.model('Product', ProductSchema);
const Order = mongoose.model('Order', OrderSchema);

// 8. IMAGE UPLOAD (CLOUDINARY)
const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'bng_surveillance',
        allowed_formats: ['jpg', 'png', 'jpeg']
    },
});
const upload = multer({ storage: storage });

// 9. ROUTES

// --- AUTH ---
app.post('/api/register', async (req, res) => {
    const { name, email, password } = req.body;
    try {
        const newUser = new User({ name, email, password });
        await newUser.save();
        res.json(newUser);
    } catch (err) {
        res.status(500).json({ error: "Registration Failed" });
    }
});

app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    if(email === "farhanzahoor03@gmail.com" && password === "farhan@coder") {
        return res.json({ name: "Farhan (Admin)", email, role: "author" });
    }
    const user = await User.findOne({ email, password });
    if(user) res.json(user);
    else res.status(401).json({ error: "Invalid Credentials" });
});

// --- PRODUCTS ---
app.get('/api/products', async (req, res) => {
    const products = await Product.find();
    res.json(products);
});

app.post('/api/products', upload.single('image'), async (req, res) => {
    const { name, category, price, desc } = req.body;
    // Cloudinary automatically sends the file URL in req.file.path
    const image = req.file ? req.file.path : "default.jpg"; 
    
    const newProduct = new Product({ name, category, price, image, desc, reviews: [] });
    await newProduct.save();
    res.json(newProduct);
});

app.delete('/api/products/:id', async (req, res) => {
    await Product.findByIdAndDelete(req.params.id);
    res.json({ message: "Deleted" });
});

// --- REVIEWS ---
app.post('/api/review/:id', async (req, res) => {
    try {
        const { user, comment } = req.body;
        const product = await Product.findById(req.params.id);
        if(product) {
            product.reviews.push({ user, comment });
            await product.save();
            res.json({ message: "Review Added" });
        } else {
            res.status(404).json({ error: "Product not found" });
        }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- RAZORPAY ---
app.post('/api/create-order', async (req, res) => {
    const { amount } = req.body; 
    try {
        const options = { amount: amount * 100, currency: "INR", receipt: "receipt_" + Date.now() };
        const order = await razorpay.orders.create(options);
        res.json(order);
    } catch (error) {
        res.status(500).json({ error: "Razorpay Error" });
    }
});

app.post('/api/verify-payment', async (req, res) => {
    const { orderCreationId, razorpayPaymentId, razorpaySignature, customerDetails } = req.body;
    const secret = process.env.RAZORPAY_KEY_SECRET || 'CHEK3LJgZHmCdhd2NyJg5DSf';
    const shasum = crypto.createHmac("sha256", secret);
    shasum.update(`${orderCreationId}|${razorpayPaymentId}`);
    const digest = shasum.digest("hex");

    if (digest !== razorpaySignature) return res.status(400).json({ message: "Invalid Transaction" });

    const newOrder = new Order({
        razorpay_order_id: orderCreationId,
        payment_status: "Paid",
        customer: customerDetails.name,
        email: customerDetails.email,
        phone: customerDetails.phone,
        address: customerDetails.address,
        items: customerDetails.items,
        total: customerDetails.total
    });
    await newOrder.save();
    res.json({ message: "Payment Successful", orderId: newOrder._id });
});

// --- ORDERS ---
app.get('/api/orders', async (req, res) => {
    const orders = await Order.find();
    res.json(orders);
});

app.get('/api/my-orders', async (req, res) => {
    const { email } = req.query;
    if(!email) return res.status(400).json({ error: "Email required" });
    const orders = await Order.find({ email }).sort({ date: -1 });
    res.json(orders);
});

// 10. START SERVER
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});