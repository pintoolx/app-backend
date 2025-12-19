// Supabase Edge Function: Verify Wallet Address and Sync User
// Validates Solana wallet address and upserts user to database

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

// Base58 alphabet used by Solana
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

interface VerifyRequest {
    wallet_address: string
    sync_user?: boolean  // Optional: whether to upsert user to database
}

interface VerifyResponse {
    valid: boolean
    synced?: boolean
    error?: string
}

function isValidBase58(str: string): boolean {
    for (const char of str) {
        if (!BASE58_ALPHABET.includes(char)) {
            return false
        }
    }
    return true
}

function decodeBase58(str: string): Uint8Array {
    const bytes: number[] = []

    for (const char of str) {
        let carry = BASE58_ALPHABET.indexOf(char)
        if (carry === -1) {
            throw new Error('Invalid Base58 character')
        }

        for (let i = 0; i < bytes.length; i++) {
            carry += bytes[i] * 58
            bytes[i] = carry & 0xff
            carry >>= 8
        }

        while (carry > 0) {
            bytes.push(carry & 0xff)
            carry >>= 8
        }
    }

    // Add leading zeros
    for (const char of str) {
        if (char === '1') {
            bytes.push(0)
        } else {
            break
        }
    }

    return new Uint8Array(bytes.reverse())
}

function validateSolanaWalletAddress(address: string): VerifyResponse {
    // Check if address is provided
    if (!address || typeof address !== 'string') {
        return { valid: false, error: 'Wallet address is required' }
    }

    // Trim whitespace
    const trimmedAddress = address.trim()

    // Check length (Solana addresses are 32-44 characters in Base58)
    if (trimmedAddress.length < 32 || trimmedAddress.length > 44) {
        return {
            valid: false,
            error: `Invalid address length: ${trimmedAddress.length}. Expected 32-44 characters.`
        }
    }

    // Check if it only contains valid Base58 characters
    if (!isValidBase58(trimmedAddress)) {
        return {
            valid: false,
            error: 'Address contains invalid characters. Only Base58 characters are allowed.'
        }
    }

    // Try to decode the address
    try {
        const decoded = decodeBase58(trimmedAddress)

        // Solana public keys are 32 bytes
        if (decoded.length !== 32) {
            return {
                valid: false,
                error: `Decoded address is ${decoded.length} bytes. Expected 32 bytes.`
            }
        }

        return { valid: true }
    } catch (err) {
        return {
            valid: false,
            error: `Failed to decode address: ${err instanceof Error ? err.message : 'Unknown error'}`
        }
    }
}

serve(async (req) => {
    // CORS headers for all responses
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    }

    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        return new Response(null, {
            status: 204,
            headers: corsHeaders,
        })
    }

    // Only allow POST requests
    if (req.method !== 'POST') {
        return new Response(
            JSON.stringify({ valid: false, error: 'Method not allowed. Use POST.' }),
            {
                status: 405,
                headers: {
                    'Content-Type': 'application/json',
                    ...corsHeaders,
                },
            }
        )
    }

    try {
        const body: VerifyRequest = await req.json()
        const result = validateSolanaWalletAddress(body.wallet_address)

        // If wallet is invalid, return early
        if (!result.valid) {
            return new Response(JSON.stringify(result), {
                status: 400,
                headers: {
                    'Content-Type': 'application/json',
                    ...corsHeaders,
                },
            })
        }

        // If sync_user is requested, upsert the user to database
        if (body.sync_user) {
            // Use service_role key to bypass RLS (only available in Edge Functions)
            const supabaseUrl = Deno.env.get('SUPABASE_URL')!
            const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

            const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)

            const { error: upsertError } = await supabaseAdmin
                .from('users')
                .upsert(
                    {
                        wallet_address: body.wallet_address.trim(),
                        catpurr: true,
                        last_active_at: new Date().toISOString(),
                    },
                    {
                        onConflict: 'wallet_address',
                    }
                )

            if (upsertError) {
                console.error('Failed to upsert user:', upsertError)
                return new Response(
                    JSON.stringify({
                        valid: true,
                        synced: false,
                        error: `Failed to sync user: ${upsertError.message}`
                    }),
                    {
                        status: 500,
                        headers: {
                            'Content-Type': 'application/json',
                            ...corsHeaders,
                        },
                    }
                )
            }

            console.log('User synced successfully:', body.wallet_address)
            return new Response(
                JSON.stringify({ valid: true, synced: true }),
                {
                    status: 200,
                    headers: {
                        'Content-Type': 'application/json',
                        ...corsHeaders,
                    },
                }
            )
        }

        // Just verify, don't sync
        return new Response(JSON.stringify(result), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                ...corsHeaders,
            },
        })
    } catch (err) {
        return new Response(
            JSON.stringify({
                valid: false,
                error: `Invalid request body: ${err instanceof Error ? err.message : 'Unknown error'}`
            }),
            {
                status: 400,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                },
            }
        )
    }
})

