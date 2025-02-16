import { t } from '@lokavaluto/lokapi'
import { Transaction } from '@lokavaluto/lokapi/build/backend'


export function getRelatedId (transactionData: t.JsonData): string | number | null {
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
        if (typeof relatedId !== 'string' && typeof relatedId !== 'number') {
            if (typeof relatedId === 'undefined') {
                return null
            } else {
                throw new Error(
                    `Unexpected 'relatedUser.id' value in transaction data: ${relatedId}`
                )
            }
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

    get currency() {
        // XXXvlab: jsonData can come from different API return result, and are not\
        // exactly the same even if they describe roughly a
        // transaction.
        // Here, on transaction lists, we have ``symbol`` and
        // ``currency`` set, with only ``symbol`` being the actual
        // currency symbol.
        // Whereas after a payment, we get only ``currency`` which is
        // the actual currency symbol as well.
        // The following allows to support both case and return the
        // currency symbol.
        return this.jsonData.cyclos.symbol || this.jsonData.cyclos.currency
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
        if (ownerId === null) {
            const cyclosRelatedUser = this.jsonData.cyclos.relatedUser?.display
            if (typeof cyclosRelatedUser === 'string') {
                return cyclosRelatedUser
            }
            throw new Error(
                'Unexpected transaction data: could not infer name of related user'
            )
        }
        if (ownerId === 'Admin') {
            return 'Admin'
        }
        return this.jsonData.odoo[ownerId]?.public_name || ownerId
    }

    get isTopUp () {
        if (this.related === 'Admin' && this.amount >= 0) {
            return true
        }
        return false
    }

    get isReconversion () {
        if (this.related === 'Admin' && this.amount <= 0) {
            return true
        }
        return false
    }
}
