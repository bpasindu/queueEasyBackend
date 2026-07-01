require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const connectDB = require('./config/db');

// Import Schemas
const User = require('./models/User');
const Clinic = require('./models/Clinic');
const Booking = require('./models/Booking');

// Import Routes
const authRoutes = require('./routes/auth');
const clinicRoutes = require('./routes/clinics');
const bookingRoutes = require('./routes/bookings');
const doctorRoutes = require('./routes/doctor');
const assistantRoutes = require('./routes/assistant');

const app = express();
const PORT = process.env.PORT || 3000;

// Connect to Database
connectDB().then(() => {
    seedDatabase();
});

// Middlewares
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

// Mount Routes
app.use('/api/auth', authRoutes);
app.use('/api/clinics', clinicRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/doctor', doctorRoutes);
app.use('/api/assistant', assistantRoutes);

// Base route
app.get('/', (req, res) => {
    res.json({
        success: true,
        message: 'Welcome to QueueEasy Backend API',
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({
        success: false,
        message: err.message || 'Server Error',
    });
});

// Seeding function
async function seedDatabase() {
    try {
        // 1. Check and Seed Users
        const userCount = await User.countDocuments();
        if (userCount === 0) {
            console.log('Seeding database with default users...');
            
            const patient = await User.create({
                name: 'Nimal Perera',
                email: 'patient@queueease.lk',
                phone: '+94771234567',
                password: 'password123', // Will be hashed via pre-save hook
                role: 'patient',
                visits: 18
            });

            const doctor = await User.create({
                name: 'Dr. Sarah Jenkins',
                email: 'doctor@queueease.lk',
                phone: '+94777654321',
                password: 'password123',
                role: 'doctor'
            });

            console.log('Users seeded successfully!');

            // 2. Check and Seed Clinics
            const clinicCount = await Clinic.countDocuments();
            if (clinicCount === 0) {
                console.log('Seeding clinics...');
                
                // Dr. Silva
                const clinicSilva = await Clinic.create({
                    doctor: 'Dr. Silva',
                    specialty: 'General Physician',
                    clinic: 'Nugegoda Clinic',
                    inQueue: 5,
                    eta: 18,
                    scheduledStart: '9:00 AM',
                    actualStart: '9:18 AM',
                    isOpen: true,
                    averageConsultTime: 6.4,
                    currentServing: 3 // To match active booking stats: serving #3, patient is slot #7
                });

                // Dr. Fernando
                await Clinic.create({
                    doctor: 'Dr. Fernando',
                    specialty: 'Pediatrician',
                    clinic: 'Maharagama Medical',
                    inQueue: 12,
                    eta: 32,
                    scheduledStart: '9:00 AM',
                    actualStart: '9:18 AM',
                    isOpen: true,
                    averageConsultTime: 6.4,
                    currentServing: 4
                });

                // Dr. Jayasinghe
                await Clinic.create({
                    doctor: 'Dr. Jayasinghe',
                    specialty: 'ENT',
                    clinic: 'Colombo 05',
                    inQueue: 3,
                    eta: 12,
                    scheduledStart: '9:00 AM',
                    actualStart: '9:18 AM',
                    isOpen: true,
                    averageConsultTime: 6.4,
                    currentServing: 4
                });

                // Dr. Sarah Jenkins (Cardiologist)
                const clinicJenkins = await Clinic.create({
                    doctor: 'Dr. Sarah Jenkins',
                    specialty: 'Cardiologist',
                    clinic: 'Cardiology Consultation Room 2',
                    inQueue: 18,
                    eta: 130,
                    scheduledStart: '9:00 AM',
                    actualStart: '9:18 AM',
                    isOpen: true,
                    averageConsultTime: 7.2,
                    currentServing: 4,
                    doctorUser: doctor._id
                });

                console.log('Clinics seeded successfully!');

                // 3. Seed initial bookings to represent slot status
                console.log('Seeding bookings...');
                
                // Seed taken slots for Dr. Silva (slots 1, 2 as completed, slot 3 as called)
                await Booking.create([
                    { patient: patient._id, clinic: clinicSilva._id, slotNumber: 1, status: 'completed', isLive: false },
                    { patient: patient._id, clinic: clinicSilva._id, slotNumber: 2, status: 'completed', isLive: false },
                    { patient: patient._id, clinic: clinicSilva._id, slotNumber: 3, status: 'called', isLive: true, startedTime: '9:18 AM' }
                ]);

                // Create the active booking for Nimal Perera (patient) at Dr. Silva's clinic (slot #7)
                // This corresponds to: wait: 26, predicted: '9:56.400000000000009 AM', started: '9:18 AM'
                await Booking.create({
                    patient: patient._id,
                    clinic: clinicSilva._id,
                    slotNumber: 7,
                    waitMinutes: 26,
                    predictedServingTime: '9:56.400000000000009 AM',
                    startedTime: '9:18 AM',
                    isLive: true,
                    status: 'pending'
                });

                // Seed some bookings for Dr. Sarah Jenkins (so she has some totalBooked)
                for (let i = 1; i <= 3; i++) {
                    await Booking.create({
                        patient: patient._id,
                        clinic: clinicJenkins._id,
                        slotNumber: i,
                        status: 'completed',
                        isLive: false
                    });
                }
                
                await Booking.create({
                    patient: patient._id,
                    clinic: clinicJenkins._id,
                    slotNumber: 4,
                    status: 'called',
                    isLive: true,
                    startedTime: '9:18 AM'
                });

                console.log('Bookings seeded successfully!');
            }
        }
    } catch (error) {
        console.error('Error seeding database:', error.message);
    }
}

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});