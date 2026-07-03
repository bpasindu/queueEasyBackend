const { OpenAI } = require('openai');
const Clinic = require('../models/Clinic');
const Booking = require('../models/Booking');

// Initialize Gemini client using OpenAI-compatible SDK
let openai;
try {
    if (process.env.GEMINI_API_KEY) {
        openai = new OpenAI({
            apiKey: process.env.GEMINI_API_KEY,
            baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/"
        });
    }
} catch (err) {
    console.error('Error initializing Gemini client:', err.message);
}

// Fallback rule-based logic if OpenAI API fails or is not configured
const handleFallbackChat = async (message, req) => {
    const cleanMsg = message.toLowerCase();

    // 1. Check for specific doctor queries
    if (cleanMsg.includes('silva')) {
        const clinic = await Clinic.findOne({ doctor: /silva/i });
        if (clinic) {
            return `Dr. Silva currently has ${clinic.inQueue} patients in the queue. The estimated waiting time is approximately ${clinic.eta} minutes.`;
        }
    }

    if (cleanMsg.includes('fernando')) {
        const clinic = await Clinic.findOne({ doctor: /fernando/i });
        if (clinic) {
            return `Dr. Fernando currently has ${clinic.inQueue} patients in the queue. The estimated waiting time is approximately ${clinic.eta} minutes.`;
        }
    }

    if (cleanMsg.includes('jayasinghe')) {
        const clinic = await Clinic.findOne({ doctor: /jayasinghe/i });
        if (clinic) {
            return `Dr. Jayasinghe currently has ${clinic.inQueue} patients in the queue. The estimated waiting time is approximately ${clinic.eta} minutes.`;
        }
    }

    // 2. Check for personal booking status queries
    if (
        cleanMsg.includes('my turn') ||
        cleanMsg.includes('my slot') ||
        cleanMsg.includes('my booking') ||
        cleanMsg.includes('my status') ||
        cleanMsg.includes('when is my')
    ) {
        const activeBooking = await Booking.findOne({
            patient: req.user.id,
            status: { $in: ['pending', 'called'] },
        }).populate('clinic');

        if (activeBooking) {
            const lastCalled = await Booking.findOne({
                clinic: activeBooking.clinic._id,
                status: 'called',
            }).sort({ slotNumber: -1 });

            const currentServingNum = lastCalled ? lastCalled.slotNumber : 1;
            const wait = Math.max(
                1,
                Math.round((activeBooking.slotNumber - currentServingNum) * activeBooking.clinic.averageConsultTime)
            );

            return `You hold Slot #${activeBooking.slotNumber} for ${activeBooking.clinic.doctor} at ${activeBooking.clinic.clinic}. You are currently ${activeBooking.slotNumber - currentServingNum} slots away from being served. Estimated wait time: ~${wait} minutes.`;
        } else {
            return "You don't have any active bookings at the moment. You can browse nearby clinics and book a slot in the 'Book' tab!";
        }
    }

    // 3. Fallback generic reply
    return "Hello! I am your QueueEase AI Assistant. You can ask me questions about specific clinic waiting lines (e.g. 'How many people are in queue for Dr. Silva?') or about your active booking status (e.g. 'When is my turn?').";
};

// @desc    Chat with AI Queue Assistant
// @route   POST /api/assistant/chat
// @access  Private
const handleChat = async (req, res) => {
    try {
        const { message } = req.body;

        if (!message) {
            return res.status(400).json({ success: false, message: 'Please provide a message' });
        }

        if (!openai || !process.env.GEMINI_API_KEY) {
            const fallbackReply = await handleFallbackChat(message, req);
            return res.status(200).json({
                success: true,
                reply: fallbackReply + "\n\n⚠️ (Gemini API key not configured. Using fallback rule-based system.)",
            });
        }

        try {
            const messages = [
                {
                    role: 'system',
                    content: `You are the QueueEase AI Assistant, a friendly and smart helper for patients using the QueueEase clinic booking application.
You help patients understand the queue status of various clinics and doctors, find available clinics, and track their active bookings.

The logged-in patient is: Name: "${req.user.name}", ID: "${req.user.id}", Email: "${req.user.email}".

Rules:
1. You have tools to query the MongoDB databases for clinics and bookings.
2. If the user asks about "my status", "my bookings", "my turn", or "when is my turn?", you must use the queryBookings tool to query bookings for this user using patient ID: "${req.user.id}".
3. Always respond with helpful, polite, and clean answers. If you write queries, write them safely and correctly.
4. If a query returns no data, explain that clearly.
5. Do not make up queue statistics or booking details. Always query the database to get real stats.
6. If the user is asking about a doctor (e.g. "Dr. Silva"), query clinics to find the matching doctor first. Remember to search case-insensitively using regex if appropriate.
7. Some useful statistics:
   - For an active booking, you can calculate the patient's position in the queue. The current serving slot is given by the clinic's currentServing field. If the patient's slotNumber is greater than currentServing, the position is (slotNumber - currentServing).
   - If the clinic is not open (isOpen is false), tell the patient that the clinic has not started yet but they can still book slots.
   - The predicted serving time is calculated dynamically and stored in the booking's predictedServingTime or slot times.`
                },
                {
                    role: 'user',
                    content: message
                }
            ];

            const tools = [
                {
                    type: 'function',
                    function: {
                        name: 'queryClinics',
                        description: 'Query the MongoDB clinics database (Clinic model) using a JSON query object. Can find clinics by doctor name, specialty, location, etc. Standard mongoose query syntax applies.',
                        parameters: {
                            type: 'object',
                            properties: {
                                query: {
                                  type: 'object',
                                  description: 'Mongoose query filter object, e.g. {"doctor": {"$regex": "silva", "$options": "i"}}'
                                }
                            },
                            required: ['query']
                        }
                    }
                },
                {
                    type: 'function',
                    function: {
                        name: 'queryBookings',
                        description: 'Query the MongoDB bookings database (Booking model) using a JSON query object. Populates clinic and patient (name, phone) automatically. Can find bookings by patient, clinic, slot number, status, etc.',
                        parameters: {
                            type: 'object',
                            properties: {
                                query: {
                                    type: 'object',
                                    description: 'Mongoose query filter object, e.g. {"patient": "userId"}'
                                }
                            },
                            required: ['query']
                        }
                    }
                }
            ];

            // Call Gemini with tools
            let response = await openai.chat.completions.create({
                model: 'gemini-2.5-flash',
                messages: messages,
                tools: tools,
                tool_choice: 'auto'
            });

            let responseMessage = response.choices[0].message;

            // If the model requested tool calls
            if (responseMessage.tool_calls) {
                messages.push(responseMessage);

                for (const toolCall of responseMessage.tool_calls) {
                    const functionName = toolCall.function.name;
                    const functionArgs = JSON.parse(toolCall.function.arguments);
                    let toolResult;

                    try {
                        if (functionName === 'queryClinics') {
                            const q = functionArgs.query || {};
                            toolResult = await Clinic.find(q);
                        } else if (functionName === 'queryBookings') {
                            const q = functionArgs.query || {};
                            toolResult = await Booking.find(q).populate('clinic').populate('patient', 'name phone');
                        }
                    } catch (dbError) {
                        console.error('Database query error in AI assistant:', dbError);
                        toolResult = { error: dbError.message };
                    }

                    messages.push({
                        tool_call_id: toolCall.id,
                        role: 'tool',
                        name: functionName,
                        content: JSON.stringify(toolResult)
                    });
                }

                // Get a new response from the model after submitting tool outputs
                response = await openai.chat.completions.create({
                    model: 'gemini-2.5-flash',
                    messages: messages
                });
                responseMessage = response.choices[0].message;
            }

            res.status(200).json({
                success: true,
                reply: responseMessage.content
            });

        } catch (openaiError) {
            console.error('Gemini calling error, falling back to rule-based chat:', openaiError.message);
            
            let note = "\n\n⚠️ (Gemini error: " + openaiError.message + ". Falling back to rule-based system.)";
            if (openaiError.message.includes('quota') || openaiError.status === 429) {
                note = "\n\n⚠️ (Gemini Quota Exceeded/Rate Limit. The provided API key has run out of funds or reached limit. Falling back to rule-based system.)";
            } else if (openaiError.status === 401) {
                note = "\n\n⚠️ (Gemini Auth Failed. The API key is invalid. Falling back to rule-based system.)";
            }

            const fallbackReply = await handleFallbackChat(message, req);
            res.status(200).json({
                success: true,
                reply: fallbackReply + note
            });
        }

    } catch (error) {
        console.error('Outer AI assistant error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    handleChat,
};
