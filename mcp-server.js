#!/usr/bin/env node

/**
 * OpenPhone MCP Server for ChatGPT Integration
 * 
 * This MCP server enables ChatGPT to interact with OpenPhone API
 * through the custom connector feature using Model Context Protocol.
 */

const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3001;
const OPENPHONE_API_BASE = 'https://api.openphone.com/v1';

// Middleware
app.use(cors());
app.use(express.json());

// Environment variables for OpenPhone API
const OPENPHONE_API_KEY = process.env.OPENPHONE_API_KEY;

if (!OPENPHONE_API_KEY) {
    console.error('OPENPHONE_API_KEY environment variable is required');
    process.exit(1);
}

// OpenPhone API client configuration
const openPhoneClient = axios.create({
    baseURL: OPENPHONE_API_BASE,
    headers: {
        'Authorization': OPENPHONE_API_KEY,
        'Content-Type': 'application/json'
    }
});

// MCP Server Capabilities
const SERVER_INFO = {
    name: "openphone-mcp-server",
    version: "1.0.0",
    description: "MCP server for OpenPhone API integration with ChatGPT",
    capabilities: {
        tools: {
            search: true,
            fetch: true
        },
        resources: true,
        prompts: false
    }
};

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'healthy', server: SERVER_INFO });
});

// MCP Server Info endpoint
app.get('/mcp/info', (req, res) => {
    res.json(SERVER_INFO);
});

// Search endpoint (required by MCP)
app.post('/mcp/search', async (req, res) => {
    try {
        const { query, limit = 10 } = req.body;
        
        // Search across different OpenPhone resources
        const searchResults = [];
        
        // Search messages
        try {
            const messagesResponse = await openPhoneClient.get('/messages', {
                params: { search: query, limit: Math.ceil(limit / 3) }
            });
            
            messagesResponse.data.data?.forEach(message => {
                searchResults.push({
                    type: 'message',
                    id: message.id,
                    title: `Message from ${message.from}`,
                    content: message.body,
                    metadata: {
                        createdAt: message.createdAt,
                        direction: message.direction,
                        status: message.status
                    }
                });
            });
        } catch (error) {
            console.warn('Failed to search messages:', error.message);
        }
        
        // Search contacts
        try {
            const contactsResponse = await openPhoneClient.get('/contacts', {
                params: { search: query, limit: Math.ceil(limit / 3) }
            });
            
            contactsResponse.data.data?.forEach(contact => {
                searchResults.push({
                    type: 'contact',
                    id: contact.id,
                    title: contact.name || contact.phoneNumber,
                    content: `Contact: ${contact.name || 'Unknown'} - ${contact.phoneNumber}`,
                    metadata: {
                        email: contact.email,
                        tags: contact.tags,
                        createdAt: contact.createdAt
                    }
                });
            });
        } catch (error) {
            console.warn('Failed to search contacts:', error.message);
        }
        
        // Search call logs
        try {
            const callsResponse = await openPhoneClient.get('/calls', {
                params: { limit: Math.ceil(limit / 3) }
            });
            
            callsResponse.data.data?.forEach(call => {
                if (call.participants?.some(p => p.includes(query))) {
                    searchResults.push({
                        type: 'call',
                        id: call.id,
                        title: `Call ${call.direction} - ${call.duration}s`,
                        content: `Call log: ${call.direction} call lasting ${call.duration} seconds`,
                        metadata: {
                            createdAt: call.createdAt,
                            status: call.status,
                            participants: call.participants
                        }
                    });
                }
            });
        } catch (error) {
            console.warn('Failed to search calls:', error.message);
        }
        
        res.json({
            results: searchResults.slice(0, limit),
            total: searchResults.length
        });
        
    } catch (error) {
        console.error('Search error:', error);
        res.status(500).json({
            error: 'Search failed',
            message: error.message
        });
    }
});

// Fetch endpoint (required by MCP)
app.post('/mcp/fetch', async (req, res) => {
    try {
        const { resource_id, type } = req.body;
        
        let data;
        
        switch (type) {
            case 'message':
                const messageResponse = await openPhoneClient.get(`/messages/${resource_id}`);
                data = messageResponse.data;
                break;
                
            case 'contact':
                const contactResponse = await openPhoneClient.get(`/contacts/${resource_id}`);
                data = contactResponse.data;
                break;
                
            case 'call':
                const callResponse = await openPhoneClient.get(`/calls/${resource_id}`);
                data = callResponse.data;
                break;
                
            case 'phone-numbers':
                const numbersResponse = await openPhoneClient.get('/phone-numbers');
                data = numbersResponse.data;
                break;
                
            default:
                throw new Error(`Unsupported resource type: ${type}`);
        }
        
        res.json({
            resource_id,
            type,
            data
        });
        
    } catch (error) {
        console.error('Fetch error:', error);
        res.status(500).json({
            error: 'Fetch failed',
            message: error.message
        });
    }
});

// OpenPhone API Tools for ChatGPT

// Send SMS
app.post('/mcp/tools/send-sms', async (req, res) => {
    try {
        const { to, message, from } = req.body;
        
        if (!to || !message) {
            return res.status(400).json({
                error: 'Missing required parameters: to, message'
            });
        }
        
        const response = await openPhoneClient.post('/messages', {
            to,
            text: message,
            from
        });
        
        res.json({
            success: true,
            message_id: response.data.id,
            data: response.data
        });
        
    } catch (error) {
        console.error('Send SMS error:', error);
        res.status(500).json({
            error: 'Failed to send SMS',
            message: error.response?.data?.message || error.message
        });
    }
});

// Make Call
app.post('/mcp/tools/make-call', async (req, res) => {
    try {
        const { to, from } = req.body;
        
        if (!to || !from) {
            return res.status(400).json({
                error: 'Missing required parameters: to, from'
            });
        }
        
        const response = await openPhoneClient.post('/calls', {
            to,
            from
        });
        
        res.json({
            success: true,
            call_id: response.data.id,
            data: response.data
        });
        
    } catch (error) {
        console.error('Make call error:', error);
        res.status(500).json({
            error: 'Failed to make call',
            message: error.response?.data?.message || error.message
        });
    }
});

// Get Messages
app.get('/mcp/tools/messages', async (req, res) => {
    try {
        const { limit = 20, phone_number_id } = req.query;
        
        const params = { limit };
        if (phone_number_id) params.phoneNumberId = phone_number_id;
        
        const response = await openPhoneClient.get('/messages', { params });
        
        res.json({
            messages: response.data.data,
            total: response.data.totalCount,
            hasMore: response.data.hasMore
        });
        
    } catch (error) {
        console.error('Get messages error:', error);
        res.status(500).json({
            error: 'Failed to retrieve messages',
            message: error.response?.data?.message || error.message
        });
    }
});

// Get Contacts
app.get('/mcp/tools/contacts', async (req, res) => {
    try {
        const { limit = 20, search } = req.query;
        
        const params = { limit };
        if (search) params.search = search;
        
        const response = await openPhoneClient.get('/contacts', { params });
        
        res.json({
            contacts: response.data.data,
            total: response.data.totalCount,
            hasMore: response.data.hasMore
        });
        
    } catch (error) {
        console.error('Get contacts error:', error);
        res.status(500).json({
            error: 'Failed to retrieve contacts',
            message: error.response?.data?.message || error.message
        });
    }
});

// Get Call History
app.get('/mcp/tools/calls', async (req, res) => {
    try {
        const { limit = 20, phone_number_id } = req.query;
        
        const params = { limit };
        if (phone_number_id) params.phoneNumberId = phone_number_id;
        
        const response = await openPhoneClient.get('/calls', { params });
        
        res.json({
            calls: response.data.data,
            total: response.data.totalCount,
            hasMore: response.data.hasMore
        });
        
    } catch (error) {
        console.error('Get calls error:', error);
        res.status(500).json({
            error: 'Failed to retrieve calls',
            message: error.response?.data?.message || error.message
        });
    }
});

// Get Phone Numbers
app.get('/mcp/tools/phone-numbers', async (req, res) => {
    try {
        const response = await openPhoneClient.get('/phone-numbers');
        
        res.json({
            phoneNumbers: response.data.data
        });
        
    } catch (error) {
        console.error('Get phone numbers error:', error);
        res.status(500).json({
            error: 'Failed to retrieve phone numbers',
            message: error.response?.data?.message || error.message
        });
    }
});

// Create Contact
app.post('/mcp/tools/create-contact', async (req, res) => {
    try {
        const { name, phoneNumber, email, tags } = req.body;
        
        if (!phoneNumber) {
            return res.status(400).json({
                error: 'Phone number is required'
            });
        }
        
        const contactData = { phoneNumber };
        if (name) contactData.name = name;
        if (email) contactData.email = email;
        if (tags) contactData.tags = tags;
        
        const response = await openPhoneClient.post('/contacts', contactData);
        
        res.json({
            success: true,
            contact: response.data
        });
        
    } catch (error) {
        console.error('Create contact error:', error);
        res.status(500).json({
            error: 'Failed to create contact',
            message: error.response?.data?.message || error.message
        });
    }
});

// Webhook endpoint for OpenPhone events
app.post('/webhooks/openphone', async (req, res) => {
    try {
        const event = req.body;
        
        // Log the webhook event
        console.log('OpenPhone webhook received:', {
            type: event.type,
            id: event.id,
            timestamp: event.createdAt
        });
        
        // Here you could implement custom logic based on webhook events
        // For example, send notifications, update databases, etc.
        
        res.status(200).json({ received: true });
        
    } catch (error) {
        console.error('Webhook error:', error);
        res.status(500).json({ error: 'Webhook processing failed' });
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`OpenPhone MCP Server running on port ${PORT}`);
    console.log(`Server URL: http://localhost:${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/health`);
    console.log(`MCP Info: http://localhost:${PORT}/mcp/info`);
    console.log('');
    console.log('Available endpoints:');
    console.log('- POST /mcp/search - Search across OpenPhone data');
    console.log('- POST /mcp/fetch - Fetch specific resources');
    console.log('- POST /mcp/tools/send-sms - Send SMS messages');
    console.log('- POST /mcp/tools/make-call - Make phone calls');
    console.log('- GET /mcp/tools/messages - Get messages');
    console.log('- GET /mcp/tools/contacts - Get contacts');
    console.log('- GET /mcp/tools/calls - Get call history');
    console.log('- GET /mcp/tools/phone-numbers - Get phone numbers');
    console.log('- POST /mcp/tools/create-contact - Create new contact');
    console.log('- POST /webhooks/openphone - Webhook endpoint');
});

module.exports = app;