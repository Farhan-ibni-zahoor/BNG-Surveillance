// 1. IMPORTS
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const cloudinary = require('cloudinary').v2;
const streamifier = require('streamifier'); 

// 2. CONFIGURATION
const app = express();
const PORT = process.env.PORT || 5000;

// 3. CLOUDINARY CONFIGURATION
cloudinary.config({ 
    cloud_name: process.env.CLOUD_NAME, 
    api_key: process.env.CLOUD_API_KEY, 
    api_secret: process.env.CLOUD_API_SECRET 
});

// 4. RAZORPAY KEYS
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// 5. DATABASE CONNECTION
const DB_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/bng-surveillance';
mongoose.connect(DB_URI)
    .then(() => console.log("✅ MongoDB Connected"))
    .catch(err => console.error("❌ DB Error:", err));

// 6. MIDDLEWARE
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 7. SCHEMAS
const UserSchema = new mongoose.Schema({
    name: String,
    email: { type: String, unique: true }, // Added unique constraint
    password: String,
    role: { type: String, default: 'customer' }
});

const ProductSchema = new mongoose.Schema({
    name: String,
    category: String,
    price: Number,
    image: String,
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

// 8. IMAGE UPLOAD CONFIG
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// --- ROUTES ---

// AUTH: REGISTER (Fixed Duplicate Issue)
app.post('/api/register', async (req, res) => {
    const { name, email, password } = req.body;
    try {
        const existing = await User.findOne({ email });
        if (existing) return res.status(400).json({ error: "Email already registered" });

        const newUser = new User({ name, email, password });
        await newUser.save();
        res.json(newUser);
    } catch (err) {
        res.status(500).json({ error: "Registration Failed" });
    }
});

// AUTH: LOGIN
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    
    // Hardcoded Admin Access
    if(email === "bngsurveillance@gmail.com" && password === "Surveillance@0627") {
        return res.json({ name: "Farhan (Admin)", email, role: "author", phone: "6006750581" }); 
    }
    
    try {
        const user = await User.findOne({ email, password });
        if(user) res.json(user);
        else res.status(401).json({ error: "Invalid Credentials" });
    } catch (e) { res.status(500).json({ error: "Server Error" }); }
});

// PRODUCTS: GET ALL
app.get('/api/products', async (req, res) => {
    try {
        const products = await Product.find();
        res.json(products);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// PRODUCTS: ADD NEW (Admin)
app.post('/api/products', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: "No image file uploaded" });

        const uploadStream = cloudinary.uploader.upload_stream(
            { folder: 'bng_surveillance', resource_type: 'image' },
            async (error, result) => {
                if (error) return res.status(500).json({ error: "Cloudinary Upload Failed" });

                const { name, category, price, desc } = req.body;
                const newProduct = new Product({ 
                    name, 
                    category, 
                    price: Number(price), // Ensure number
                    image: result.secure_url, 
                    desc, 
                    reviews: [] 
                });
                await newProduct.save();
                res.json(newProduct);
            }
        );
        streamifier.createReadStream(req.file.buffer).pipe(uploadStream);
    } catch (err) {
        res.status(500).json({ error: "Server Error" });
    }
});

// REVIEWS
app.post('/api/review/:id', async (req, res) => {
    try {
        const { user, comment } = req.body;
        const product = await Product.findById(req.params.id);
        if(!product) return res.status(404).json({ error: "Product not found" });

        product.reviews.push({ user, comment });
        await product.save();
        res.json({ message: "Review Added" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// RAZORPAY: CREATE ORDER
app.post('/api/create-order', async (req, res) => {
    try {
        const { amount } = req.body; 
        const options = {
            amount: amount * 100, // Convert to paisa
            currency: "INR",
            receipt: "receipt_" + Date.now()
        };
        const order = await razorpay.orders.create(options);
        res.json(order);
    } catch (error) {
        res.status(500).json({ error: "Razorpay Error" });
    }
});

// RAZORPAY: VERIFY
app.post('/api/verify-payment', async (req, res) => {
    const { orderCreationId, razorpayPaymentId, razorpaySignature, customerDetails } = req.body;

    try {
        const shasum = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET);
        shasum.update(`${orderCreationId}|${razorpayPaymentId}`);
        const digest = shasum.digest("hex");

        if (digest !== razorpaySignature) {
            return res.status(400).json({ message: "Invalid Transaction" });
        }

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
    } catch (error) {
        res.status(500).json({ error: "Verification Error" });
    }
});

// ADMIN: GET ALL ORDERS
app.get('/api/orders', async (req, res) => {
    const orders = await Order.find().sort({ date: -1 });
    res.json(orders);
});

// USER: GET MY ORDERS
app.get('/api/my-orders', async (req, res) => {
    const { email } = req.query;
    if(!email) return res.status(400).json({ error: "Email required" });
    const orders = await Order.find({ email }).sort({ date: -1 });
    res.json(orders);
});

app.listen(PORT, () => console.log(`🚀 BNG Server Active on Port ${PORT}`));