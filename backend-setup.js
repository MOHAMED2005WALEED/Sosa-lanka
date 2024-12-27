// server.js
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));

// File Upload Configuration
const storage = multer.diskStorage({
    destination: './uploads/',
    filename: function(req, file, cb) {
        cb(null, 'product-' + Date.now() + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 1000000 },
    fileFilter: function(req, file, cb) {
        checkFileType(file, cb);
    }
}).single('image');

function checkFileType(file, cb) {
    const filetypes = /jpeg|jpg|png|webp/;
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = filetypes.test(file.mimetype);

    if (mimetype && extname) {
        return cb(null, true);
    } else {
        cb('Error: Images Only!');
    }
}

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/cream-business', {
    useNewUrlParser: true,
    useUnifiedTopology: true
});

// Models
const productSchema = new mongoose.Schema({
    name: { type: String, required: true },
    nameSi: { type: String, required: true },
    description: { type: String, required: true },
    descriptionSi: { type: String, required: true },
    price: { type: Number, required: true },
    stock: { type: Number, required: true },
    image: { type: String },
    category: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});

const orderSchema = new mongoose.Schema({
    customerName: { type: String, required: true },
    phone: { type: String, required: true },
    address: { type: String, required: true },
    products: [{
        productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
        quantity: { type: Number, required: true }
    }],
    totalAmount: { type: Number, required: true },
    status: { type: String, default: 'pending' },
    createdAt: { type: Date, default: Date.now }
});

const adminSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});

const Product = mongoose.model('Product', productSchema);
const Order = mongoose.model('Order', orderSchema);
const Admin = mongoose.model('Admin', adminSchema);

// Authentication Middleware
const authenticateAdmin = async (req, res, next) => {
    try {
        const token = req.header('Authorization').replace('Bearer ', '');
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const admin = await Admin.findById(decoded.id);
        
        if (!admin) {
            throw new Error();
        }

        req.admin = admin;
        next();
    } catch (error) {
        res.status(401).json({ error: 'Please authenticate.' });
    }
};

// Routes
// Admin Authentication
app.post('/api/admin/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const admin = await Admin.findOne({ username });

        if (!admin || !(await bcrypt.compare(password, admin.password))) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const token = jwt.sign({ id: admin._id }, process.env.JWT_SECRET, { expiresIn: '24h' });
        res.json({ token });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Products
app.get('/api/products', async (req, res) => {
    try {
        const products = await Product.find();
        res.json(products);
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/products', authenticateAdmin, upload, async (req, res) => {
    try {
        const productData = {
            ...req.body,
            image: req.file ? `/uploads/${req.file.filename}` : null
        };
        const product = new Product(productData);
        await product.save();
        res.status(201).json(product);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.put('/api/products/:id', authenticateAdmin, upload, async (req, res) => {
    try {
        const productData = {
            ...req.body
        };
        if (req.file) {
            productData.image = `/uploads/${req.file.filename}`;
        }
        const product = await Product.findByIdAndUpdate(req.params.id, productData, { new: true });
        res.json(product);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.delete('/api/products/:id', authenticateAdmin, async (req, res) => {
    try {
        await Product.findByIdAndDelete(req.params.id);
        res.json({ message: 'Product deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Orders
app.post('/api/orders', async (req, res) => {
    try {
        const order = new Order(req.body);
        
        // Update stock
        for (const item of order.products) {
            const product = await Product.findById(item.productId);
            if (product.stock < item.quantity) {
                return res.status(400).json({ error: 'Insufficient stock' });
            }
            product.stock -= item.quantity;
            await product.save();
        }
        
        await order.save();
        res.status(201).json(order);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.get('/api/orders', authenticateAdmin, async (req, res) => {
    try {
        const orders = await Order.find().populate('products.productId');
        res.json(orders);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/orders/:id', authenticateAdmin, async (req, res) => {
    try {
        const order = await Order.findByIdAndUpdate(req.params.id, req.body, { new: true });
        res.json(order);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Error handling
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something went wrong!' });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
