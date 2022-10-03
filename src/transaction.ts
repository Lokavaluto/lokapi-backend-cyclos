import { t } from '@lokavaluto/lokapi'
import { Transaction } from '@lokavaluto/lokapi/build/backend'


export function getRelatedId(transactionData: t.JsonData): string | number {
    const related = transactionData.related
    if (typeof related !== 'object') {
        throw new Error(
            `Unexpected 'related' object in transaction data: ${related}`
        )
    }

    const kind = (<t.JsonData>related).kind
    if (typeof kind !== 'string') {
        throw new Error(
            `Unexpected 'kind' value in 'related' of transaction data: ${kind}`
        )
    }

    if (kind === 'user') {
        const relatedUser = transactionData.relatedUser
        if (typeof relatedUser !== 'object') {
            throw new Error(
                `Unexpected 'relatedUser' object in transaction data: ${relatedUser}`
            )
        }
        const relatedId = (<t.JsonData>relatedUser).id
        if (typeof relatedId !== 'string' &&
            typeof relatedId !== 'number') {
            throw new Error(
                `Unexpected 'relatedUser.id' value in transaction data: ${relatedId}`
            )
        }
        return relatedId
    }
    if (kind === 'system') {
        return 'Admin'
    }
    throw new Error(
        `Unexpected 'related.kind' value in transaction data: ${kind}`
    )
}


export class CyclosTransaction extends Transaction {

    get amount () {
        return this.jsonData.cyclos.amount
    }

    get currency () {
        return this.jsonData.cyclos.currency
    }

    get date () {
        return new Date(this.jsonData.cyclos.date)
    }

    get description () {
        return this.jsonData.cyclos.description
    }

    get id () {
        return this.jsonData.cyclos.id
    }

    get related () {
        const ownerId = getRelatedId(this.jsonData.cyclos)
        if (ownerId === 'Admin') {
            return 'Admin'
        }
        return this.jsonData.odoo[ownerId]?.public_name || ownerId
    }
}
