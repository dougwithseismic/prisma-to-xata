#!/usr/bin/env node

import { getDMMF, serializeQueryEngineName } from '@prisma/sdk'
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'

/**
 * @typedef FieldSchema
 * @property {string} name - The name of the field.
 * @property {'object' | 'scalar' | 'enum' | 'union'} kind - The type of field.
 * ... other properties ...
 */
type FieldSchema = {
    name: string
    kind: 'object' | 'scalar' | 'enum' | 'union'
    isList: boolean
    isRequired: boolean
    isUnique: boolean
    isId: boolean
    isReadOnly: boolean
    hasDefaultValue: boolean
    type: string
    relationName?: string
    relationFromFields?: string[]
    relationToFields?: string[]
    isGenerated: boolean
    isUpdatedAt: boolean
    default?: {
        name: string
        args: any[]
    }
}

/**
 * A mapping between Prisma types and Xata types.
 */
export const PRISMA_TO_XATA_MAPPINGS: Record<string, string> = {
    String: 'string',
    Boolean: 'bool',
    Int: 'int',
    BigInt: 'int',
    Float: 'float',
    Decimal: 'float',
    DateTime: 'datetime',
    Json: 'text',
    Bytes: 'text',
}

/**
 * Converts a Prisma type to its Xata type counterpart.
 *
 * @param {FieldSchema} field - A Prisma field schema.
 * @returns {string} The corresponding Xata type.
 */

export function prismaTypeToXataType(field: FieldSchema): string {
    if (field.name === 'email') return 'email'
    if (field.relationName) return 'link'
    return PRISMA_TO_XATA_MAPPINGS[field.type] || 'string'
}

/**
 * Handles the default value for a field.
 *
 * @param {FieldSchema} field - A Prisma field schema.
 * @returns {string | undefined} The default value or undefined.
 */

export function handleDefaultValue(field: FieldSchema): string | undefined {
    const { name, type, isUnique, relationName, default: defaultValue } = field

    if (['id', 'email'].includes(name) || isUnique || relationName) return

    if (type === 'Boolean' && defaultValue) {
        return defaultValue.toString()
    }

    if (defaultValue?.name === 'autoincrement') return
    if (defaultValue?.name) return defaultValue.name

    return defaultValue?.toString()
}

/**
 * Fetches the introspected schema from a given path.
 *
 * @param {string} schemaPath - Path to the schema file.
 * @returns {Promise<any>} The introspected schema.
 */

export async function getIntrospectedSchema(schemaPath: string) {
    const datamodel = fs.readFileSync(schemaPath, 'utf-8')
    return await getDMMF({ datamodel, prismaPath: './node_modules/.prisma/client', cwd: process.cwd() })
}

/**
 * Handles the not-null constraint for a field.
 *
 * @param {FieldSchema} field - A Prisma field schema.
 * @returns {boolean | undefined} Whether the field is not null or undefined.
 */
export function handleNotNull(field: FieldSchema): boolean | undefined {
    if (field.name === 'id' || field.isUnique || prismaTypeToXataType(field) === 'link') return
    return field.isRequired
}

/**
 * Handles the link relation for a field.
 *
 * @param {FieldSchema} field - A Prisma field schema.
 * @returns {{ table: string } | undefined} The link relation or undefined.
 */
export function handleLink(field: FieldSchema): { table: string } | undefined {
    return prismaTypeToXataType(field) === 'link' ? { table: field.type } : undefined
}

/**
 * Converts a Prisma schema to a Xata schema using the Prisma SDK.
 *
 * @param {string} path - Path to the Prisma schema file.
 * @returns {Promise<any>} The converted Xata schema.
 */

export async function convertPrismaToXataUsingSDK(path: string) {
    const dmmf = await getIntrospectedSchema(path)

    return {
        tables: dmmf.datamodel.models.map((model) => ({
            name: model.name,
            columns: model.fields
                .map((field) => {
                    if (field.name === 'id') return

                    return {
                        name: field.name,
                        type: prismaTypeToXataType(field as FieldSchema),
                        link: handleLink(field as FieldSchema),
                        defaultValue: handleDefaultValue(field as FieldSchema),
                        unique: field.isUnique,
                        notNull: handleNotNull(field as FieldSchema),
                    }
                })
                .filter(Boolean),
        })),
    }
}

/**
 * Saves the Xata schema to a file.
 *
 * @param {any} xataSchema - The Xata schema.
 * @param {string} filePath - Path to the file where the schema should be saved.
 */

export function saveXataSchemaToFile(xataSchema: any, filePath: string) {
    fs.writeFileSync(filePath, JSON.stringify(xataSchema, null, 2))
}

;(async () => {
    // Check if the script is in the root directory
    const isInRoot = process.cwd() === path.dirname(__filename)

    if (!isInRoot) {
        // Copy this script to root directory
        const destination = path.join(process.cwd(), 'prisma-to-xata.js')
        fs.copyFileSync(__filename, destination)

        // Execute the script from root
        const prismaPath = `"${process.argv[2]}"` || '"./prisma/schema.prisma"'
        const xataOutputPath = `"${process.argv[3]}"` || '"./xataSchema.json"'

        execSync(`node "${destination}" ${prismaPath} ${xataOutputPath}`, {
            stdio: 'inherit',
        })

        fs.unlinkSync(destination) // Optionally remove the script after execution

        return // Exit the script
    }

    try {
        const prismaSchemaPath = process.argv[2] || './prisma/schema.prisma'
        const xataSchemaOutputPath = process.argv[3] || './xataSchema.json'

        const xataSchema = await convertPrismaToXataUsingSDK(prismaSchemaPath)
        saveXataSchemaToFile(xataSchema, xataSchemaOutputPath)
    } catch (error) {
        console.error('Error converting Prisma schema to Xata:', error)
    }
})()

// Usage:
// 1. Generate the xataSchema.json using ts-node prisma-to-xata.ts './prisma/schema.prisma' './xataSchema.json'
// 2. Run the xata upload command: xata schema upload xataSchema.json
// 3. n.b. As of writing, xata init schema=... throws an error always, but uploading works fine.
