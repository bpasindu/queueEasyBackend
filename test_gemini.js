require('dotenv').config();
const { OpenAI } = require('openai');

const run = async () => {
    const key = process.env.GEMINI_API_KEY;
    console.log('Gemini Key starting with:', key ? key.substring(0, 8) : 'undefined');

    const endpoints = [
        "https://generativelanguage.googleapis.com/v1beta/openai/",
        "https://generativelanguage.googleapis.com/v1beta/"
    ];

    for (const endpoint of endpoints) {
        console.log(`\n--- Testing endpoint: ${endpoint} ---`);
        try {
            const openai = new OpenAI({
                apiKey: key,
                baseURL: endpoint
            });
            const completion = await openai.chat.completions.create({
                model: "gemini-2.5-flash",
                messages: [{ role: "user", content: "Say hello in one word." }]
            });
            console.log('Success!', completion.choices[0].message.content);
        } catch (err) {
            console.error('Error with endpoint:', endpoint, err.status, err.message);
        }
    }

    process.exit(0);
};

run();
