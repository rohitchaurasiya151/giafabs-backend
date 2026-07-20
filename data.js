// ════════════════════════════════════════════════════════════════════════════════
// GIAFABS DATA LAYER — seed data. In production this maps to PostgreSQL tables.
// ════════════════════════════════════════════════════════════════════════════════
const { hashPw } = require('./core');
const config = require('./src/config');

const DB = {
  // ─────────── WOMEN'S FASHION PRODUCTS ───────────
  products: [
    {id:'PRD001',sku:'WKTA001',name:'Emerald Silk Kurta with Embroidery',description:'Handcrafted emerald silk kurta with traditional gold threadwork embroidery.',category:'Kurtas',subcategory:'Designer Kurtas',brand:'Artisan Crafts',price:2499,mrp:4999,b2bPrice:1699,cost:1200,fabric:'Pure Silk',color:'Emerald Green',sizes:['XS','S','M','L','XL','XXL'],gst:12,hsn:'61103090',weight:0.45,stock:28,minStock:5,active:true,featured:true,isNew:true,badge:'New',rating:4.7,reviews:42,international:true,tags:['ethnic','silk','festive'],images:['kurta-emerald']},
    {id:'PRD002',sku:'WSRT001',name:'Banarasi Cotton Saree',description:'Authentic Banarasi cotton saree with zari border and traditional motifs.',category:'Sarees',subcategory:'Banarasi',brand:'Heritage Looms',price:3299,mrp:6999,b2bPrice:2199,cost:1800,fabric:'Banarasi Cotton',color:'Maroon & Gold',sizes:['Freesize'],gst:5,hsn:'62044200',weight:0.8,stock:15,minStock:3,active:true,featured:true,isNew:false,badge:'Bestseller',rating:4.9,reviews:67,international:true,tags:['saree','banarasi','wedding'],images:['saree-banarasi']},
    {id:'PRD003',sku:'WJMP001',name:'Blue Denim Jumpsuit',description:'Modern fitted denim jumpsuit with button details — perfect for casual outings.',category:'Western Wear',subcategory:'Jumpsuits',brand:'Contemporary India',price:1899,mrp:3499,b2bPrice:1299,cost:900,fabric:'Cotton Denim',color:'Blue',sizes:['XS','S','M','L','XL'],gst:12,hsn:'61124090',weight:0.35,stock:42,minStock:8,active:true,featured:false,isNew:true,badge:'New',rating:4.5,reviews:28,international:true,tags:['western','denim','casual'],images:['jumpsuit-denim']},
    {id:'PRD004',sku:'WSAL001',name:'Chanderi Salwar Suit Set',description:'3-piece premium Chanderi salwar suit with dupatta — perfect for weddings.',category:'Salwar Suits',subcategory:'Designer Suits',brand:'Regal Fabrics',price:5499,mrp:10999,b2bPrice:3999,cost:3200,fabric:'Chanderi',color:'Navy Blue',sizes:['32','34','36','38','40'],gst:12,hsn:'61103090',weight:0.6,stock:12,minStock:2,active:true,featured:true,isNew:false,badge:'Premium',rating:4.8,reviews:51,international:true,tags:['ethnic','wedding','chanderi'],images:['suit-chanderi']},
    {id:'PRD005',sku:'WKUR002',name:'Pastel Pink Rayon Kurti',description:'Comfortable rayon kurti with ethnic prints — perfect for daily wear.',category:'Kurtas',subcategory:'Casual Kurtas',brand:'Everyday Ethnic',price:799,mrp:1599,b2bPrice:549,cost:380,fabric:'Rayon',color:'Pastel Pink',sizes:['XS','S','M','L','XL','XXL'],gst:12,hsn:'61103090',weight:0.25,stock:156,minStock:15,active:true,featured:false,isNew:true,badge:'Budget',rating:4.3,reviews:94,international:true,tags:['kurti','daily','budget'],images:['kurti-pink']},
    {id:'PRD006',sku:'WLHG001',name:'Kanjivaram Silk Lehenga',description:'Luxurious Kanjivaram silk lehenga with intricate gold zari work — bridal collection.',category:'Lehengas',subcategory:'Bridal',brand:'Royal Weaves',price:12999,mrp:25999,b2bPrice:9599,cost:7500,fabric:'Kanjivaram Silk',color:'Deep Red',sizes:['32','34','36','38'],gst:5,hsn:'62044200',weight:1.2,stock:8,minStock:1,active:true,featured:true,isNew:false,badge:'Luxury',rating:5.0,reviews:18,international:true,tags:['lehenga','bridal','luxury'],images:['lehenga-red']},
    {id:'PRD007',sku:'WTOP001',name:'White Cotton Crop Top',description:'Minimalist white cotton crop top — versatile for any occasion.',category:'Western Wear',subcategory:'Tops',brand:'Urban Wear',price:599,mrp:1299,b2bPrice:399,cost:250,fabric:'Cotton',color:'White',sizes:['XS','S','M','L','XL'],gst:12,hsn:'61103090',weight:0.15,stock:89,minStock:10,active:true,featured:false,isNew:true,badge:'New',rating:4.4,reviews:36,international:true,tags:['western','top','minimal'],images:['top-white']},
    {id:'PRD008',sku:'WDRS001',name:'Black Maxi Dress',description:'Elegant black maxi dress with off-shoulder design — perfect for evening wear.',category:'Western Wear',subcategory:'Dresses',brand:'Contemporary India',price:2199,mrp:4499,b2bPrice:1499,cost:1000,fabric:'Polyester Blend',color:'Black',sizes:['XS','S','M','L','XL','XXL'],gst:12,hsn:'61123090',weight:0.4,stock:34,minStock:5,active:true,featured:true,isNew:false,badge:'Trending',rating:4.6,reviews:48,international:true,tags:['western','dress','evening'],images:['dress-black']},
    {id:'PRD009',sku:'WSCF001',name:'Ajrakh Hand Block Printed Scarf',description:'Traditional Ajrakh hand-block printed cotton scarf — fair-trade artisan product.',category:'Accessories',subcategory:'Scarves',brand:'Artisan Collective',price:1299,mrp:2499,b2bPrice:899,cost:650,fabric:'Cotton',color:'Indigo & Rust',sizes:['Freesize'],gst:12,hsn:'62016100',weight:0.2,stock:67,minStock:10,active:true,featured:true,isNew:false,badge:'Handmade',rating:4.8,reviews:73,international:true,tags:['accessory','scarf','handmade'],images:['scarf-ajrakh']},
    {id:'PRD010',sku:'WSHL001',name:'Pashmina Wool Shawl',description:'Premium Kashmiri pashmina shawl — soft, warm and luxurious.',category:'Accessories',subcategory:'Shawls',brand:'Kashmir Classics',price:4999,mrp:9999,b2bPrice:3599,cost:2800,fabric:'Pashmina',color:'Cream',sizes:['Freesize'],gst:12,hsn:'62091100',weight:0.35,stock:22,minStock:3,active:true,featured:true,isNew:false,badge:'Premium',rating:4.9,reviews:55,international:true,tags:['accessory','shawl','luxury'],images:['shawl-pashmina']},
  ],

  // ─────────── PRODUCT CATEGORIES (dynamic — admin-managed) ───────────
  categories: [
    {name:'Kurtas',       slug:'kurtas',       gstRate:12, active:true, sortOrder:1},
    {name:'Sarees',       slug:'sarees',       gstRate:5,  active:true, sortOrder:2},
    {name:'Salwar Suits', slug:'salwar-suits', gstRate:12, active:true, sortOrder:3},
    {name:'Lehengas',     slug:'lehengas',     gstRate:5,  active:true, sortOrder:4},
    {name:'Western Wear', slug:'western-wear', gstRate:12, active:true, sortOrder:5},
    {name:'Accessories',  slug:'accessories',  gstRate:12, active:true, sortOrder:6},
  ],

  // ─────────── PRODUCT FABRICS (dynamic — admin-managed) ───────────
  fabrics: [
    {name:'Pure Silk',        slug:'pure-silk',        active:true, sortOrder:1},
    {name:'Banarasi Cotton',  slug:'banarasi-cotton',  active:true, sortOrder:2},
    {name:'Cotton Denim',     slug:'cotton-denim',     active:true, sortOrder:3},
    {name:'Chanderi',         slug:'chanderi',         active:true, sortOrder:4},
    {name:'Rayon',            slug:'rayon',            active:true, sortOrder:5},
    {name:'Kanjivaram Silk',  slug:'kanjivaram-silk',  active:true, sortOrder:6},
    {name:'Polyester Blend',  slug:'polyester-blend',  active:true, sortOrder:7},
    {name:'Cotton',           slug:'cotton',           active:true, sortOrder:8},
    {name:'Pashmina',         slug:'pashmina',         active:true, sortOrder:9},
  ],

  // ─────────── SHOP-BY-OCCASION CURATED LINKS (dynamic — admin-managed) ───────────
  occasions: [
    {id:'OCC001', label:'Wedding',     category:'Lehengas',      active:true, sortOrder:1},
    {id:'OCC002', label:'Festive',     category:'Sarees',        active:true, sortOrder:2},
    {id:'OCC003', label:'Office Wear', category:'Salwar Suits',  active:true, sortOrder:3},
    {id:'OCC004', label:'Casual Days', category:'Kurtas',        active:true, sortOrder:4},
    {id:'OCC005', label:'Party Wear',  category:'Accessories',   active:true, sortOrder:5},
  ],

  orders: [
    {id:'GIAFABS0001',createdAt:'2026-07-10T10:00:00Z',updatedAt:'2026-07-12T15:30:00Z',type:'b2c',customer:{name:'Priya Sharma',email:'priya.sharma@example.com',mobile:'9876543210'},shippingAddress:{firstName:'Priya',lastName:'Sharma',line1:'123 Fashion Street',line2:'Apt 4B',city:'Mumbai',state:'Maharashtra',pincode:'400001',country:'India',countryCode:'IN'},items:[{productId:'PRD001',size:'M',name:'Emerald Silk Kurta with Embroidery',sku:'WKTA001',hsn:'61103090',gstRate:12,unitPrice:2499,qty:1,lineSubtotal:2499,lineGst:300}],payment:{method:'cod',status:'pending',transactionId:null,gatewayOrderId:null},pricing:{subtotal:2499,gst:300,discount:0,coupon:null,shipping:49,codCharge:50,total:2898,currency:'INR',currencySymbol:'₹',fxRate:1,totalInCurrency:2898},tax:{gstin:'07AAJPT5055K1Z0',state:'Maharashtra',label:'CGST + SGST (intra-state)'},status:'delivered',isInternational:false,tracking:{partner:'Delhivery',awb:'DLV1234567890',providerOrderId:'SR123456',history:[{label:'Order Placed',done:true,time:'2026-07-10T10:00:00Z'},{label:'Order Confirmed (COD)',done:true,time:'2026-07-10T10:15:00Z'},{label:'Shipment Created',done:true,time:'2026-07-10T11:00:00Z'},{label:'Order Delivered',done:true,time:'2026-07-12T15:30:00Z'}]},shippingStatus:'delivered'}
  ],
  orderRequests: [
    {id:'RET0001',type:'return',orderId:'GIAFABS0001',customer:{name:'Priya Sharma',email:'priya.sharma@example.com'},reason:'defective',notes:'The kurta has loose stitching on the sleeves',returnItems:[{productId:'PRD001',size:'M',qty:1,name:'Emerald Silk Kurta with Embroidery'}],status:'requested',requestedAt:'2026-07-12T16:00:00Z',updatedAt:'2026-07-12T16:00:00Z',reverseAWB:null,reverseShipmentId:null,adminNote:''}
  ],
  transactions: [],
  customerAuth: [
    {id:'CU1001',name:'Priya Sharma',email:'priya.sharma@example.com',mobile:'9876543210',passwordHash:hashPw('test123'),createdAt:'2026-07-10T10:00:00Z',wallet:0,addresses:[]}
  ],
  cartItems: [],
  wishlistItems: [],
  productVariants: [],
  customerSessions: {},   // token -> {customerId, expires}
  adminSessions: {},      // token -> {userId, expires}
  auditLog: [],
  tickets: [],
  coupons: [
    {code:'WELCOME10',type:'percent',value:10,minOrder:999,maxDiscount:500,active:true,usageLimit:1000,used:0,expiresAt:'2026-12-31'},
    {code:'FLAT200',type:'flat',value:200,minOrder:1499,maxDiscount:200,active:true,usageLimit:500,used:0,expiresAt:'2026-12-31'},
    {code:'FESTIVE25',type:'percent',value:25,minOrder:2999,maxDiscount:2000,active:true,usageLimit:200,used:0,expiresAt:'2026-12-31'},
  ],

  countries: [
    {code:'IN',name:'India',currency:'INR',symbol:'₹',rate:1,shipBase:49,shipPerKg:25,codAvailable:true,days:'3–7'},
    {code:'US',name:'United States',currency:'USD',symbol:'$',rate:0.012,shipBase:18,shipPerKg:8,codAvailable:false,days:'7–14'},
    {code:'GB',name:'United Kingdom',currency:'GBP',symbol:'£',rate:0.0095,shipBase:15,shipPerKg:7,codAvailable:false,days:'7–12'},
    {code:'CA',name:'Canada',currency:'CAD',symbol:'C$',rate:0.0165,shipBase:20,shipPerKg:9,codAvailable:false,days:'8–15'},
    {code:'AU',name:'Australia',currency:'AUD',symbol:'A$',rate:0.0185,shipBase:22,shipPerKg:10,codAvailable:false,days:'9–16'},
    {code:'AE',name:'United Arab Emirates',currency:'AED',symbol:'د.إ',rate:0.044,shipBase:12,shipPerKg:6,codAvailable:false,days:'4–8'},
    {code:'SG',name:'Singapore',currency:'SGD',symbol:'S$',rate:0.0162,shipBase:14,shipPerKg:7,codAvailable:false,days:'5–9'},
    {code:'DE',name:'Germany',currency:'EUR',symbol:'€',rate:0.011,shipBase:16,shipPerKg:8,codAvailable:false,days:'7–13'},
  ],

  inventory: { movements: [], purchaseOrders: [] },

  employees: [
    {id:'EMP001',name:'Priya Nair',email:'priya@giafabs.com',role:'Manager',phone:'9876543210',active:true,joinDate:'2024-01-15'},
    {id:'EMP002',name:'Ritu Shah',email:'ritu@giafabs.com',role:'Operations',phone:'9876543211',active:true,joinDate:'2024-02-01'},
  ],

  users: [
    {id:'U001',name:'Super Admin',email:config.admin.email,passwordHash:hashPw(config.admin.initialPassword),role:'superadmin',permissions:['*'],active:true},
    {id:'U002',name:'Store Manager',email:'manager@giafabs.com',passwordHash:hashPw('manager123'),role:'manager',permissions:[],active:true},
    {id:'U003',name:'Support Agent',email:'support@giafabs.com',passwordHash:hashPw('support123'),role:'support',permissions:[],active:true},
  ],

  // ─────────── FEATURE FLAGS — admin toggles, frontend obeys ───────────
  featureFlags: {
    wishlist: true,
    reviews: true,
    coupons: true,
    internationalShipping: true,
    guestBrowsing: true,          // browse without login (checkout still needs login)
    codPayment: true,
    razorpayPayment: true,
    upiPayment: true,
    recentlyViewed: true,
    exitIntentOffer: false,
    liveChat: false,
    loyaltyProgram: false,
    maintenanceMode: false,       // kill switch — shows maintenance page
  },

  // ─────────── CMS CONTENT — frontend text/hero from backend ───────────
  content: {
    announcement: { enabled: true, text: 'Free shipping on orders above ₹999 · New arrivals every week', bg: '#6B4E71' },
    hero: [
      { title: 'Timeless Elegance', subtitle: 'Handcrafted ethnic wear for the modern woman', cta: 'Shop New Arrivals', link: 'collection', theme: 'plum' },
      { title: 'Wedding Season', subtitle: 'Lehengas & sarees that make moments unforgettable', cta: 'Explore Bridal', link: 'collection', theme: 'gold' },
      { title: 'Everyday Comfort', subtitle: 'Kurtis & western wear for every day', cta: 'Shop Casuals', link: 'collection', theme: 'teal' },
    ],
    about: 'GIAFABS celebrates the craft of Indian womenswear — from handloom sarees to contemporary silhouettes. Every piece is chosen for quality, comfort, and timeless style.',
    contactEmail: 'support@giafabs.com',
    contactPhone: '+91 98765 43210',
    footerNote: 'Made with care for women, by women.',
  },

  // ─────────── THEME — frontend colors from backend ───────────
  theme: {
    plum: '#6B4E71', teal: '#3D7A6F', gold: '#C9A84C',
    coral: '#D4614E', rose: '#F8EEE7', cream: '#FDF8F3',
    lav: '#EEE8F8', sage: '#E8EFE8',
    headingFont: 'Playfair Display', bodyFont: 'Inter',
  },

  settings: {
    store: {
      name: "GIAFABS — Women's Fashion", legalName: 'GIAFABS Retail Pvt Ltd',
      email: 'support@giafabs.in', phone: '+91 98765 43210', supportPhone: '+91 98765 43211',
      address: 'Textile Market, Ring Road, Surat, Gujarat 395002',
      gstin: '24AAFCU5055K1ZM', pan: 'AAFCU5055K', cin: 'U52609GJ2023PTC000000',
      homeState: 'Gujarat', homePincode: '395002',
      currency: 'INR', timezone: 'Asia/Kolkata', weightUnit: 'kg',
      statementName: 'GIAFABS', logoUrl: '',
      returnWindowDays: 7,
    },

    // ─────────── PAYMENTS (deep — multi-gateway + methods + partial pay) ───────────
    payments: {
      // global payment method toggles
      methods: { cod: true, card: true, upi: true, netbanking: true, wallet: true, emi: false },
      // partial / advance payment rule for high-value orders
      partialPayment: { enabled: true, minOrderValue: 9999, advancePercent: 25, note: 'Pay 25% now, rest on delivery for orders above ₹9,999' },
      // COD controls
      cod: { enabled: true, charge: 30, maxValue: 5000, minValue: 0, restrictToServiceablePincodes: true, extraChargeAbove: 3000, extraCharge: 20 },
      // free shipping + fraud
      freeShippingMin: 999,
      fraud: { enable3DS: true, avsCheck: true, flagHighValue: 20000, blockAfterFailedAttempts: 5 },
      // legacy fields kept for compatibility with existing order engine
      codEnabled: true, codCharge: 30, codMaxValue: 5000,
      razorpayEnabled: true, razorpayKeyId: 'rzp_test_DEMO', razorpaySecret: 'demo_secret_key_for_signature_verification',
      upiEnabled: true, standardShipping: 49, codShipping: 79,
    },

    // ─────────── INTEGRATIONS HUB (each = card in dashboard) ───────────
    integrations: {
      // PAYMENT GATEWAYS
      razorpay:  { category:'payment', label:'Razorpay',  enabled:true,  mode:'test', keyId:'rzp_test_DEMO', keySecret:'demo_secret_key_for_signature_verification', webhookSecret:'', status:'connected',    fee:'2%' },
      payu:      { category:'payment', label:'PayU',      enabled:false, mode:'test', merchantKey:'', merchantSalt:'', webhookSecret:'', status:'disconnected', fee:'2%' },
      cashfree:  { category:'payment', label:'Cashfree',  enabled:false, mode:'test', appId:'', secretKey:'', webhookSecret:'', status:'disconnected', fee:'1.95%' },
      phonepe:   { category:'payment', label:'PhonePe',   enabled:false, mode:'test', merchantId:'', saltKey:'', saltIndex:'1', webhookSecret:'', status:'disconnected', fee:'1.99%' },
      ccavenue:  { category:'payment', label:'CCAvenue',  enabled:false, mode:'test', merchantId:'', accessCode:'', workingKey:'', webhookSecret:'', status:'disconnected', fee:'2%' },
      // SHIPPING / LOGISTICS
      shiprocket:{ category:'shipping', label:'Shiprocket (multi-courier)', enabled:true, email:'', password:'', channelId:'', pickupPincode:'395002', autoPush:true, webhookSecret:'', status:'connected' },
      delhivery: { category:'shipping', label:'Delhivery (direct)', enabled:false, apiToken:'', clientName:'', pickupLocation:'', pickupAddress:'', pickupState:'', pickupPhone:'', sellerGstTin:'', pickupPincode:'395002', autoPush:false, status:'disconnected' },
      bluedart:  { category:'shipping', label:'Bluedart', enabled:false, licenseKey:'', loginId:'', status:'disconnected' },
      dtdc:      { category:'shipping', label:'DTDC', enabled:false, accessToken:'', customerCode:'', status:'disconnected' },
      porter:    { category:'shipping', label:'Porter (hyperlocal)', enabled:false, apiKey:'', status:'disconnected' },
      manualShip:{ category:'shipping', label:'Manual / Self Delivery', enabled:true, note:'Owner arranges delivery manually', status:'connected' },
      // MARKETING / COMMS / ACCOUNTING
      metaPixel: { category:'marketing', label:'Meta Pixel + CAPI', enabled:false, pixelId:'', accessToken:'', status:'disconnected' },
      ga4:       { category:'marketing', label:'Google Analytics 4', enabled:false, measurementId:'', apiSecret:'', status:'disconnected' },
      whatsapp:  { category:'comms', label:'WhatsApp (Interakt/Gupshup)', enabled:false, provider:'interakt', apiKey:'', phoneNumberId:'', status:'disconnected' },
      msg91:     { category:'comms', label:'MSG91 (SMS/OTP)', enabled:false, authKey:'', senderId:'GIAFAB', status:'disconnected' },
      sendgrid:  { category:'comms', label:'SendGrid (Email)', enabled:false, apiKey:'', fromEmail:'orders@giafabs.in', status:'disconnected' },
      tally:     { category:'accounting', label:'Tally ERP', enabled:false, companyName:'', syncMode:'manual', status:'disconnected' },
      woocommerce:{category:'channel', label:'WooCommerce', enabled:false, url:'', consumerKey:'', consumerSecret:'', status:'disconnected' },
      shopify:   { category:'channel', label:'Shopify', enabled:false, shopUrl:'', accessToken:'', status:'disconnected' },
      amazon:    { category:'channel', label:'Amazon', enabled:false, sellerId:'', mwsToken:'', status:'disconnected' },
    },

    // ─────────── SHIPPING ENGINE (zones + rate rules + COD pincodes + packages) ───────────
    shipping: {
      defaultCourier: 'shiprocket',
      courierPriority: ['shiprocket','delhivery','bluedart','dtdc','manualShip'],
      zones: [
        { id:'z_dom', name:'Domestic (India)', type:'domestic', countries:['IN'], rateMode:'weight', freeAbove:999,
          slabs:[{uptoKg:0.5,price:49},{uptoKg:1,price:69},{uptoKg:2,price:99},{uptoKg:5,price:149},{uptoKg:999,price:249}] },
        { id:'z_intl', name:'International', type:'international', countries:['US','GB','CA','AU','AE','SG','DE'], rateMode:'weight', freeAbove:0,
          slabs:[{uptoKg:0.5,price:1200},{uptoKg:1,price:1900},{uptoKg:2,price:2900},{uptoKg:999,price:4500}] },
      ],
      packages: [
        { name:'Poly Bag S', l:25, b:20, h:3, weight:0.05 },
        { name:'Box M', l:30, b:25, h:8, weight:0.15 },
        { name:'Box L (Lehenga)', l:40, b:30, h:15, weight:0.4 },
      ],
      codServiceablePincodes: ['395002','395001','380001','400001','110001','560001','600001','700001'],
      codPincodeMode: 'blocklist_off', // allow all except explicitly blocked; or 'allowlist' to restrict
      estimatedDaysDomestic: '3–7', estimatedDaysIntl: '7–15',
    },

    // ─────────── TAX ENGINE (GST, overrides, exemptions) ───────────
    tax: {
      pricesIncludeTax: false,
      taxOnShipping: false,
      defaultGst: 12,
      // per-HSN overrides
      hsnRates: { '61103090':12, '62044200':5, '61124090':12, '61123090':12, '62016100':12, '62091100':12 },
      // per-category overrides
      categoryRates: { 'Sarees':5, 'Lehengas':5, 'Kurtas':12, 'Salwar Suits':12, 'Western Wear':12, 'Accessories':12 },
      exportZeroRated: true, lutNumber: 'LUT/2024/GJ/000123',
      // tax-exempt B2B customers by GSTIN
      exemptCustomers: [],
    },

    // ─────────── CHECKOUT CONFIG ───────────
    checkout: {
      contactMethod: 'both',           // email | phone | both
      accountPolicy: 'required',       // optional | required | disabled
      requirePhone: true, requireCompanyGstin: false,
      allowGuestBrowsing: true,
      orderNotesField: true,
      minOrderValue: 0,
      abandonedCartReminder: true,
    },

    // ─────────── NOTIFICATIONS (editable templates) ───────────
    notifications: {
      channels: { email: true, sms: true, whatsapp: false },
      templates: {
        orderConfirmed:  { subject:'Your GIAFABS order {orderId} is confirmed 💜', body:'Hi {name}, thank you! Your order {orderId} of ₹{total} is confirmed and being prepared.' },
        orderShipped:    { subject:'Your order {orderId} has shipped 📦', body:'Hi {name}, your order is on the way! Track it here: {trackingUrl}' },
        orderDelivered:  { subject:'Delivered! Order {orderId} 🎉', body:'Hi {name}, your GIAFABS order has been delivered. We hope you love it!' },
        codConfirm:      { subject:'Confirm your COD order {orderId}', body:'Hi {name}, please confirm your COD order {orderId} of ₹{total}.' },
        abandonedCart:   { subject:'You left something behind 💝', body:'Hi {name}, your favourites are waiting. Complete your order and get free shipping!' },
      },
    },

    // ─────────── ROLE / PERMISSION DEFINITIONS (editable) ───────────
    roles: {
      superadmin: { label:'Super Admin', perms:['*'] },
      manager:    { label:'Store Manager', perms:['orders.read','orders.update','products.*','inventory.*','reports.read','coupons.*','shipping.*'] },
      operations: { label:'Operations', perms:['orders.read','orders.update','inventory.*','shipping.*'] },
      finance:    { label:'Finance', perms:['orders.read','reports.*','transactions.read','tax.*'] },
      support:    { label:'Support', perms:['orders.read','customers.read','customers.update','tickets.*'] },
    },

    meta: { pixelId: '', accessToken: '' },
  },
};

module.exports = { DB };
