const jwt = require('jsonwebtoken');

// Mock admin users (in production, query from database)
const ADMIN_USERS = {
  'admin@giafabs.com': {
    id: 'admin-1',
    email: 'admin@giafabs.com',
    name: 'Admin',
    password: 'admin123', // In production, use hashed password
    role: 'admin',
  },
};

exports.loginAdmin = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Find admin user
    const admin = ADMIN_USERS[email];
    if (!admin) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Verify password (in production, use bcrypt)
    if (admin.password !== password) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate JWT token
    const token = jwt.sign(
      {
        id: admin.id,
        email: admin.email,
        name: admin.name,
        role: 'admin',
      },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      token,
      admin: {
        id: admin.id,
        email: admin.email,
        name: admin.name,
        role: 'admin',
      },
    });
  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.getAdminStats = async (req, res) => {
  try {
    // TODO: Implement actual database queries
    // For now, return mock data
    const stats = {
      total_orders: 254,
      total_revenue: 1598543,
      avg_order_value: 6290,
      delivered: 240,
      cancelled: 14,
      paid: 254,
    };

    res.json(stats);
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.getAdminSettings = async (req, res) => {
  try {
    // TODO: Query from database
    const settings = {
      store_name: 'GIAFABS',
      store_email: 'support@giafabs.com',
      store_phone: '+91-9876543210',
      store_address: '123 Handloom Street',
      store_city: 'Bangalore',
      store_state: 'Karnataka',
      store_pin: '560001',
      store_gstin: '29AABCT1234H1Z0',
      return_window_days: 7,
      max_refund_amount: 100000,
    };

    res.json(settings);
  } catch (error) {
    console.error('Error fetching settings:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.updateAdminSettings = async (req, res) => {
  try {
    const { store_name, store_email, store_phone, store_address, store_city, store_state, store_pin, store_gstin, return_window_days, max_refund_amount } = req.body;

    // TODO: Update in database
    const settings = {
      store_name,
      store_email,
      store_phone,
      store_address,
      store_city,
      store_state,
      store_pin,
      store_gstin,
      return_window_days,
      max_refund_amount,
    };

    res.json({
      success: true,
      message: 'Settings updated successfully',
      settings,
    });
  } catch (error) {
    console.error('Error updating settings:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
