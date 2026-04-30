/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/strategy_runtime.json`.
 */
export type StrategyRuntime = {
  "address": "FBh8hmjZYZhrhi1ionZHCVxrBbjn6s9oSGnSu3gV4vkF",
  "metadata": {
    "name": "strategyRuntime",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Strategy runtime registry for Anchor-backed deployments"
  },
  "instructions": [
    {
      "name": "closeDeployment",
      "docs": [
        "Phase 1 — close a stopped deployment, returning rent to the creator."
      ],
      "discriminator": [
        0,
        65,
        162,
        218,
        47,
        208,
        26,
        62
      ],
      "accounts": [
        {
          "name": "creator",
          "writable": true,
          "signer": true
        },
        {
          "name": "deployment",
          "writable": true
        },
        {
          "name": "strategyState",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "closeFollowerVault",
      "docs": [
        "Phase 2 — close a closed follower vault, returning rent to the follower."
      ],
      "discriminator": [
        110,
        107,
        247,
        154,
        8,
        245,
        123,
        179
      ],
      "accounts": [
        {
          "name": "follower",
          "writable": true,
          "signer": true
        },
        {
          "name": "followerVault",
          "writable": true
        },
        {
          "name": "authority",
          "writable": true
        },
        {
          "name": "subscription",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "commitState",
      "docs": [
        "Phase 1 — append a new private state commitment with replay protection."
      ],
      "discriminator": [
        201,
        80,
        148,
        145,
        9,
        196,
        225,
        56
      ],
      "accounts": [
        {
          "name": "creator",
          "signer": true
        },
        {
          "name": "deployment"
        },
        {
          "name": "strategyState",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "expectedRevision",
          "type": "u32"
        },
        {
          "name": "newPrivateStateCommitment",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "lastResultCode",
          "type": "u32"
        }
      ]
    },
    {
      "name": "delegateStrategyState",
      "docs": [
        "Delegate the strategy_state PDA to an Ephemeral Rollups validator.",
        "This CPIs into the MagicBlock delegation program so the PDA can sign",
        "via invoke_signed with its seeds."
      ],
      "discriminator": [
        26,
        244,
        148,
        247,
        58,
        170,
        109,
        182
      ],
      "accounts": [
        {
          "name": "creator",
          "writable": true,
          "signer": true
        },
        {
          "name": "deployment"
        },
        {
          "name": "strategyState",
          "docs": [
            "We use AccountInfo because the owner changes during this instruction."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  114,
                  97,
                  116,
                  101,
                  103,
                  121,
                  95,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "deployment"
              }
            ]
          }
        },
        {
          "name": "delegationBuffer",
          "writable": true
        },
        {
          "name": "delegationRecord",
          "writable": true
        },
        {
          "name": "delegationMetadata",
          "writable": true
        },
        {
          "name": "delegationProgram",
          "address": "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh"
        },
        {
          "name": "ownerProgram",
          "address": "FBh8hmjZYZhrhi1ionZHCVxrBbjn6s9oSGnSu3gV4vkF"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "validator",
          "docs": [
            "Optional: validator pubkey to delegate to."
          ],
          "optional": true
        }
      ],
      "args": []
    },
    {
      "name": "initializeDeployment",
      "docs": [
        "Phase 1 — bind a deployment record (DB UUID -> on-chain account) to",
        "a published strategy version. Lifecycle starts at draft."
      ],
      "discriminator": [
        170,
        47,
        77,
        172,
        226,
        183,
        47,
        224
      ],
      "accounts": [
        {
          "name": "creator",
          "writable": true,
          "signer": true
        },
        {
          "name": "strategyVersion"
        },
        {
          "name": "deployment",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  114,
                  97,
                  116,
                  101,
                  103,
                  121,
                  95,
                  100,
                  101,
                  112,
                  108,
                  111,
                  121,
                  109,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "deploymentId"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "deploymentId",
          "type": {
            "array": [
              "u8",
              16
            ]
          }
        },
        {
          "name": "executionMode",
          "type": "u8"
        },
        {
          "name": "deploymentNonce",
          "type": "u64"
        }
      ]
    },
    {
      "name": "initializeFollowerSubscription",
      "docs": [
        "Phase 2 — enrol a follower into a deployment by creating a",
        "`StrategySubscription` PDA. Follower self-signs."
      ],
      "discriminator": [
        129,
        224,
        47,
        216,
        30,
        160,
        254,
        248
      ],
      "accounts": [
        {
          "name": "follower",
          "writable": true,
          "signer": true
        },
        {
          "name": "deployment"
        },
        {
          "name": "subscription",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  114,
                  97,
                  116,
                  101,
                  103,
                  121,
                  95,
                  115,
                  117,
                  98,
                  115,
                  99,
                  114,
                  105,
                  112,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "deployment"
              },
              {
                "kind": "account",
                "path": "follower"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "subscriptionId",
          "type": {
            "array": [
              "u8",
              16
            ]
          }
        }
      ]
    },
    {
      "name": "initializeFollowerVault",
      "docs": [
        "Phase 2 — create the follower vault PDA bound to a subscription."
      ],
      "discriminator": [
        116,
        211,
        222,
        132,
        131,
        66,
        103,
        133
      ],
      "accounts": [
        {
          "name": "follower",
          "writable": true,
          "signer": true
        },
        {
          "name": "subscription",
          "writable": true
        },
        {
          "name": "followerVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  111,
                  108,
                  108,
                  111,
                  119,
                  101,
                  114,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "subscription"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "vaultId",
          "type": {
            "array": [
              "u8",
              16
            ]
          }
        },
        {
          "name": "custodyMode",
          "type": "u8"
        }
      ]
    },
    {
      "name": "initializeFollowerVaultAuthority",
      "docs": [
        "Phase 2 — create the follower-vault authority PDA used as the stable",
        "execution surface for delegate / session-key flows."
      ],
      "discriminator": [
        62,
        32,
        180,
        193,
        34,
        199,
        156,
        144
      ],
      "accounts": [
        {
          "name": "follower",
          "writable": true,
          "signer": true
        },
        {
          "name": "followerVault",
          "writable": true
        },
        {
          "name": "authority",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  111,
                  108,
                  108,
                  111,
                  119,
                  101,
                  114,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "followerVault"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "initializeStrategyState",
      "docs": [
        "Phase 1 — initialise the private state pointer with revision = 0."
      ],
      "discriminator": [
        17,
        112,
        180,
        5,
        104,
        112,
        237,
        204
      ],
      "accounts": [
        {
          "name": "creator",
          "writable": true,
          "signer": true
        },
        {
          "name": "deployment"
        },
        {
          "name": "strategyState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  114,
                  97,
                  116,
                  101,
                  103,
                  121,
                  95,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "deployment"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "initializeStrategyVersion",
      "docs": [
        "Phase 1 — register an immutable strategy version with hashes."
      ],
      "discriminator": [
        90,
        125,
        163,
        166,
        179,
        178,
        143,
        70
      ],
      "accounts": [
        {
          "name": "creator",
          "writable": true,
          "signer": true
        },
        {
          "name": "strategyVersion",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  114,
                  97,
                  116,
                  101,
                  103,
                  121,
                  95,
                  118,
                  101,
                  114,
                  115,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "arg",
                "path": "strategyId"
              },
              {
                "kind": "arg",
                "path": "version"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "strategyId",
          "type": {
            "array": [
              "u8",
              16
            ]
          }
        },
        {
          "name": "version",
          "type": "u32"
        },
        {
          "name": "publicMetadataHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "privateDefinitionCommitment",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "initializeVaultAuthority",
      "docs": [
        "Phase 1 — register a vault authority PDA owned by the deployment."
      ],
      "discriminator": [
        47,
        125,
        11,
        209,
        248,
        240,
        52,
        77
      ],
      "accounts": [
        {
          "name": "creator",
          "writable": true,
          "signer": true
        },
        {
          "name": "deployment",
          "writable": true
        },
        {
          "name": "vaultAuthority",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "deployment"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "custodyMode",
          "type": "u8"
        }
      ]
    },
    {
      "name": "setFollowerVaultStatus",
      "docs": [
        "Phase 2 — lifecycle transition for follower vault and its subscription."
      ],
      "discriminator": [
        132,
        242,
        199,
        183,
        43,
        164,
        165,
        13
      ],
      "accounts": [
        {
          "name": "follower",
          "writable": true,
          "signer": true
        },
        {
          "name": "followerVault",
          "writable": true
        },
        {
          "name": "subscription",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "newStatus",
          "type": "u8"
        }
      ]
    },
    {
      "name": "setLifecycleStatus",
      "docs": [
        "Phase 1 — apply a lifecycle transition (state machine enforced)."
      ],
      "discriminator": [
        213,
        110,
        41,
        59,
        63,
        128,
        0,
        162
      ],
      "accounts": [
        {
          "name": "creator",
          "signer": true
        },
        {
          "name": "deployment",
          "writable": true
        },
        {
          "name": "strategyState",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "newStatus",
          "type": "u8"
        }
      ]
    },
    {
      "name": "setPublicSnapshot",
      "docs": [
        "Phase 1 — publish/update the public snapshot (monotonic revision)."
      ],
      "discriminator": [
        150,
        34,
        45,
        243,
        165,
        224,
        1,
        232
      ],
      "accounts": [
        {
          "name": "creator",
          "writable": true,
          "signer": true
        },
        {
          "name": "deployment"
        },
        {
          "name": "publicSnapshot",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  117,
                  98,
                  108,
                  105,
                  99,
                  95,
                  115,
                  110,
                  97,
                  112,
                  115,
                  104,
                  111,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "deployment"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "expectedSnapshotRevision",
          "type": "u32"
        },
        {
          "name": "statusCode",
          "type": "u8"
        },
        {
          "name": "riskBand",
          "type": "u8"
        },
        {
          "name": "pnlSummaryBps",
          "type": "i32"
        },
        {
          "name": "publicMetricsHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "followerVault",
      "discriminator": [
        110,
        28,
        220,
        217,
        243,
        116,
        178,
        127
      ]
    },
    {
      "name": "followerVaultAuthority",
      "discriminator": [
        10,
        191,
        26,
        44,
        189,
        30,
        81,
        71
      ]
    },
    {
      "name": "publicSnapshot",
      "discriminator": [
        181,
        191,
        251,
        130,
        141,
        12,
        185,
        59
      ]
    },
    {
      "name": "strategyDeployment",
      "discriminator": [
        254,
        129,
        110,
        2,
        29,
        29,
        89,
        139
      ]
    },
    {
      "name": "strategyState",
      "discriminator": [
        83,
        18,
        224,
        109,
        174,
        100,
        39,
        139
      ]
    },
    {
      "name": "strategySubscription",
      "discriminator": [
        3,
        219,
        166,
        34,
        148,
        79,
        177,
        227
      ]
    },
    {
      "name": "strategyVersion",
      "discriminator": [
        96,
        218,
        183,
        254,
        179,
        87,
        232,
        175
      ]
    },
    {
      "name": "vaultAuthority",
      "discriminator": [
        132,
        34,
        187,
        202,
        202,
        195,
        211,
        53
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "invalidLifecycleTransition",
      "msg": "Lifecycle status transition is not allowed for the current state"
    },
    {
      "code": 6001,
      "name": "staleRevision",
      "msg": "Strategy state revision is not the expected next value (replay protection)"
    },
    {
      "code": 6002,
      "name": "snapshotNotMonotonic",
      "msg": "Public snapshot revision must be strictly greater than the current value"
    },
    {
      "code": 6003,
      "name": "deploymentNotStopped",
      "msg": "Deployment must be in stopped state before it can be closed"
    },
    {
      "code": 6004,
      "name": "unauthorizedCreator",
      "msg": "Provided authority does not match the deployment creator"
    },
    {
      "code": 6005,
      "name": "invalidExecutionMode",
      "msg": "Provided execution mode is not recognised"
    },
    {
      "code": 6006,
      "name": "invalidLifecycleCode",
      "msg": "Provided lifecycle status code is not recognised"
    },
    {
      "code": 6007,
      "name": "invalidCustodyMode",
      "msg": "Provided custody mode code is not recognised"
    },
    {
      "code": 6008,
      "name": "followerVaultNotClosed",
      "msg": "Follower vault must be in closed state before it can be removed"
    },
    {
      "code": 6009,
      "name": "unauthorizedFollower",
      "msg": "Provided follower wallet does not match the recorded subscription"
    },
    {
      "code": 6010,
      "name": "subscriptionDeploymentMismatch",
      "msg": "Subscription belongs to a different deployment than the supplied account"
    }
  ],
  "types": [
    {
      "name": "followerVault",
      "docs": [
        "Follower vault PDA. Seeded by `(FOLLOWER_VAULT_SEED, subscription)`. Public",
        "control shell for the follower's funds; treasury balances live in Umbra",
        "and execution state lives in PER. The on-chain row only holds authority",
        "and lifecycle metadata."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "subscription",
            "type": "pubkey"
          },
          {
            "name": "deployment",
            "type": "pubkey"
          },
          {
            "name": "follower",
            "type": "pubkey"
          },
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "vaultId",
            "docs": [
              "16-byte UUID mirroring the off-chain `follower_vaults.id`."
            ],
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "lifecycleStatus",
            "docs": [
              "0 = pending_funding, 1 = active, 2 = paused, 3 = exiting, 4 = closed"
            ],
            "type": "u8"
          },
          {
            "name": "custodyMode",
            "docs": [
              "0 = program_owned, 1 = self_custody, 2 = private_payments_relay"
            ],
            "type": "u8"
          },
          {
            "name": "createdSlot",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "reserved",
            "type": {
              "array": [
                "u8",
                64
              ]
            }
          }
        ]
      }
    },
    {
      "name": "followerVaultAuthority",
      "docs": [
        "Follower-vault authority PDA. Seeded by",
        "`(FOLLOWER_VAULT_AUTHORITY_SEED, follower_vault)`. Provides a stable",
        "authority surface for scoped session-key or delegate execution. Phase-2",
        "only persists routing fields; transfer / mint configuration land later."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "followerVault",
            "type": "pubkey"
          },
          {
            "name": "follower",
            "type": "pubkey"
          },
          {
            "name": "status",
            "docs": [
              "0 = active, 1 = frozen"
            ],
            "type": "u8"
          },
          {
            "name": "allowedMintConfigHash",
            "docs": [
              "Hash over the allowed mint config — empty until configured."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "reserved",
            "type": {
              "array": [
                "u8",
                64
              ]
            }
          }
        ]
      }
    },
    {
      "name": "publicSnapshot",
      "docs": [
        "Public snapshot — sanitised view of the deployment for marketplace/leaderboard."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "deployment",
            "type": "pubkey"
          },
          {
            "name": "snapshotRevision",
            "type": "u32"
          },
          {
            "name": "publishedSlot",
            "type": "u64"
          },
          {
            "name": "statusCode",
            "docs": [
              "0=running, 1=paused, 2=stopped, 3=closed (mirrors a subset of LifecycleStatus)"
            ],
            "type": "u8"
          },
          {
            "name": "riskBand",
            "docs": [
              "Risk band code: 0=unknown,1=low,2=medium,3=high"
            ],
            "type": "u8"
          },
          {
            "name": "pnlSummaryBps",
            "docs": [
              "PnL summary in bps (signed, can be negative)."
            ],
            "type": "i32"
          },
          {
            "name": "publicMetricsHash",
            "docs": [
              "Hash over the larger off-chain metrics blob."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "reserved",
            "type": {
              "array": [
                "u8",
                64
              ]
            }
          }
        ]
      }
    },
    {
      "name": "strategyDeployment",
      "docs": [
        "Anchored deployment record. The DB authoritative `id` is mirrored here as a",
        "16-byte UUID so PDAs can be derived without depending on Postgres."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "strategyVersion",
            "type": "pubkey"
          },
          {
            "name": "vaultAuthority",
            "type": "pubkey"
          },
          {
            "name": "deploymentId",
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "executionMode",
            "type": "u8"
          },
          {
            "name": "lifecycleStatus",
            "type": "u8"
          },
          {
            "name": "deploymentNonce",
            "type": "u64"
          },
          {
            "name": "initializedSlot",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "reserved",
            "type": {
              "array": [
                "u8",
                64
              ]
            }
          }
        ]
      }
    },
    {
      "name": "strategyState",
      "docs": [
        "Private state pointer — holds the latest commitment and a monotonic",
        "revision so off-chain runs (or the ER session) can append-only update."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "deployment",
            "type": "pubkey"
          },
          {
            "name": "lifecycleStatus",
            "type": "u8"
          },
          {
            "name": "stateRevision",
            "type": "u32"
          },
          {
            "name": "privateStateCommitment",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "lastResultCode",
            "type": "u32"
          },
          {
            "name": "lastCommitSlot",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "reserved",
            "type": {
              "array": [
                "u8",
                64
              ]
            }
          }
        ]
      }
    },
    {
      "name": "strategySubscription",
      "docs": [
        "One subscription PDA per `(deployment, follower)` pair. Public anchor for",
        "the follower's enrollment in a creator's strategy. Sensitive subscription",
        "configuration (max capital, drawdown guard, allocation mode, etc.) stays",
        "in the off-chain `strategy_subscriptions` table or in PER-private state;",
        "the on-chain account only carries authority and lifecycle facts.",
        "",
        "Lifecycle status mirrors the off-chain enum:",
        "0 = pending_funding, 1 = active, 2 = paused, 3 = exiting, 4 = closed"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "deployment",
            "type": "pubkey"
          },
          {
            "name": "follower",
            "type": "pubkey"
          },
          {
            "name": "followerVault",
            "type": "pubkey"
          },
          {
            "name": "subscriptionId",
            "docs": [
              "16-byte UUID mirroring the DB row id so PDAs can be derived without",
              "touching Postgres."
            ],
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "lifecycleStatus",
            "type": "u8"
          },
          {
            "name": "createdSlot",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "reserved",
            "type": {
              "array": [
                "u8",
                64
              ]
            }
          }
        ]
      }
    },
    {
      "name": "strategyVersion",
      "docs": [
        "Anchored representation of a published strategy version.",
        "Holds the public/private commitment hashes so deployments can prove they",
        "reference an immutable revision."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "creator",
            "docs": [
              "Wallet that authored the strategy."
            ],
            "type": "pubkey"
          },
          {
            "name": "strategyId",
            "docs": [
              "16-byte UUID identifying the parent strategy in the off-chain DB."
            ],
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "version",
            "docs": [
              "Monotonic version number assigned at publish time."
            ],
            "type": "u32"
          },
          {
            "name": "publicMetadataHash",
            "docs": [
              "Hash over the sanitised public metadata (display surface)."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "privateDefinitionCommitment",
            "docs": [
              "Commitment over the private definition (full IR)."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "registeredSlot",
            "docs": [
              "Slot the version was registered on chain."
            ],
            "type": "u64"
          },
          {
            "name": "bump",
            "docs": [
              "PDA bump seed."
            ],
            "type": "u8"
          },
          {
            "name": "reserved",
            "docs": [
              "Reserved bytes for forward compatibility."
            ],
            "type": {
              "array": [
                "u8",
                64
              ]
            }
          }
        ]
      }
    },
    {
      "name": "vaultAuthority",
      "docs": [
        "Vault authority PDA — owns custodial assets when treasury_mode requires",
        "program-controlled custody. Phase 1 only persists routing fields; transfer",
        "instructions land in Phase 2."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "deployment",
            "type": "pubkey"
          },
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "custodyMode",
            "docs": [
              "0=public_self_custody, 1=program_owned, 2=private_payments_relay"
            ],
            "type": "u8"
          },
          {
            "name": "status",
            "docs": [
              "0=active, 1=frozen"
            ],
            "type": "u8"
          },
          {
            "name": "allowedMintConfigHash",
            "docs": [
              "Hash over the allowed mint config — empty until configured."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "reserved",
            "type": {
              "array": [
                "u8",
                64
              ]
            }
          }
        ]
      }
    }
  ]
};
