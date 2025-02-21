interface ApiKeyConfig {
    key: string;
    name: string;
    pattern?: RegExp;
    required: boolean;
}

const API_KEY_CONFIGS: ApiKeyConfig[] = [
    {
        key: 'NEXT_PUBLIC_SIMLI_API_KEY',
        name: 'Public Simli Key',
        pattern: /^[a-z0-9]{18,30}$/,
        required: true
    },
    {
        key: 'GOOGLE_GEMINI_API_KEY',
        name: 'Google Gemini',
        required: true
    },
    {
        key: 'GOOGLE_CLOUD_TTS_KEY',
        name: 'Google Cloud TTS',
        required: true
    }
];

export function validateApiKeys() {
    const errors: string[] = [];

    for (const config of API_KEY_CONFIGS) {
        const value = process.env[config.key];

        // Check if key exists
        if (!value) {
            if (config.required) {
                errors.push(`${config.name} API key (${config.key}) is missing`);
            }
            continue;
        }

        // Check if key matches expected pattern
        if (config.pattern && !config.pattern.test(value)) {
            errors.push(`${config.name} API key (${config.key}) is invalid format`);
        }
    }

    return {
        valid: errors.length === 0,
        errors
    };
}