// server.js

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const Razorpay = require('razorpay');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 5000;

// 1. RAZORPAY KEYS
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID || 'rzp_test_S6anGX8BwOZEL8', 
    key_secret: process.env.RAZORPAY_KEY_SECRET || 'CHEK3LJgZHmCdhd2NyJg5DSf'
});

// 2. MIDDLEWARE & CORS
// We allow all origins for safety, but you can restrict to your domain later if needed
app.use(cors({ origin: '*', credentials: true })); 
app.use(express.json());
app.use('/uploads', express.static('uploads')); // Serve images statically
app.use(express.static('public')); // Serve the frontend HTML

// 3. DATABASE CONNECTION (LOCALHOST vs ATLAS)
// Logic to switch between Localhost and Cloud based on environment
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/bng-surveillance';

mongoose.connect('mongodb+srv://farhan_admin:<db_password>@cluster0.sniaz6r.mongodb.net/?appName=Cluster0')
    .then(() => console.log("✅ MongoDB Connected"))
    .catch(err => {
        console.error("❌ Database Connection Error:", err);
        // Don't crash the server on startup if DB is down, just log it
    });

// 4. SCHEMAS
const UserSchema = new mongoose.Schema({
    name: String, email: String, password: String, role: { type: String, default: 'customer' }
});

const ProductSchema = new mongoose.Schema({
    name: String, category: String, price: Number, image: String, desc: String,
    reviews: [{ user: String, comment: String, date: { type: Date, default: Date.now } }]
});

const OrderSchema = new mongoose.Schema({
    razorpay_order_id: String, payment_status: String, customer: String, email: String,
    phone: String, address: String, items: Array, total: Number,
    date: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const Product = mongoose.model('Product', ProductSchema);
const Order = mongoose.model('Order', OrderSchema);

// 5. IMAGE UPLOAD CONFIG
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage: storage });


// 6. ROUTES

// --- AUTH ---
app.post('/api/login', async (req, res) => {
    try {
        console.log("Login request received:", req.body); // Debug log
        const { email, password } = req.body;
        
        // Hardcoded Admin Check
        if(email === "farhanzahoor03@gmail.com" && password === "farhan@coder") {
            console.log("Admin login successful");
            return res.json({ name: "Farhan (Admin)", email, role: "author" });
        }

        // Customer Check
        const user = await User.findOne({ email, password });
        if(user) {
            console.log("Customer login successful");
            res.json(user);
        } else {
            console.log("Invalid credentials");
            res.status(401).json({ error: "Invalid Credentials" });
        }
    } catch (err) {
        console.error("Login Error:", err);
        res.status(500).json({ error: "Server Error" });
    }
});

app.post('/api/register', async (req, res) => {
    try {
        const { name, email, password } = req.body;
        const userExists = await User.findOne({ email });
        if (userExists) return res.status(400).json({ error: "Email already exists" });

        const newUser = new User({ name, email, password, role: 'customer' });
        await newUser.save();
        res.json({ message: "Registered successfully" });
    } catch (err) { res.status(500).json(err); }
});

// --- PRODUCTS ---
app.get('/api/products', async (req, res) => {
    const products = await Product.find();
    res.json(products);
});

app.post('/api/products', upload.single('image'), async (req, res) => {
    const { name, category, price, desc } = req.body;
    const image = req.file ? req.file.filename : "default.jpg";
    
    const newProduct = new Product({ name, category, price, image, desc, reviews: [] });
    await newProduct.save();
    res.json(newProduct);
});

app.delete('/api/products/:id', async (req, res) => {
    await Product.findByIdAndDelete(req.params.id);
    res.json({ message: "Deleted" });
});

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
    } catch (err) { res.status(500).json(err); }
});

// --- RAZORPAY PAYMENT ROUTES ---
app.post('/api/create-order', async (req, res) => {
    const { amount } = req.body; 

    try {
        const options = {
            amount: amount * 100, 
            currency: "INR",
            receipt: "receipt_" + Date.now()
        };
        const order = await razorpay.orders.create(options);
        res.json(order);
    } catch (error) {
        console.error("Create Order Error:", error);
        res.status(500).json({ error: "Something went wrong creating Razorpay order" });
    }
});

app.post('/api/verify-payment', async (req, res) => {
    const { orderCreationId, razorpayPaymentId, razorpaySignature, customerDetails } = req.body;

    const secret = process.env.RAZORPAY_KEY_SECRET || 'CHEK3LJgZHmCdhd2NyJg5DSf'; 
    
    const shasum = crypto.createHmac("sha256", secret);
    shasum.update(`${orderCreationId}|${razorpayPaymentId}`);
    const digest = shasum.digest("hex");

    if (digest !== razorpaySignature) {
        console.error("Invalid Signature");
        return res.status(400).json({ message: "Invalid Transaction" });
    }

    // Save Verified Order
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


// 7. START SERVER
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`Database: ${MONGO_URI}`);
});