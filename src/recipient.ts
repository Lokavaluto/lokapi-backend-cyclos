import { t, e } from '@lokavaluto/lokapi'
import { Contact } from '@lokavaluto/lokapi/build/backend/odoo/contact'
import { e as RequestExc } from '@0k/types-request'

import { CyclosTransaction } from './transaction'


export class CyclosRecipient extends Contact implements t.IRecipient {

    get backendId () {
        return this.parent.internalId
    }

    get fromUserAccount () {
        return this.backends.cyclos
    }

    getSymbol () {
        return this.fromUserAccount.getSymbol()
    }

    public async transfer (
        amount: number,
        senderMemo: string,
        recipientMemo: string = senderMemo
    ) {
        if (senderMemo !== recipientMemo)
            throw Error(
                "Cyclos backend doesn't support split memo on transfer yet."
            )

        const jsonDataPerform = await this.backends.cyclos.$get(
            '/self/payments/data-for-perform',
            {
                to: this.jsonData.cyclos.owner_id,
            }
        )
        if (!jsonDataPerform.paymentTypes) {
            throw new Error('Unexpected data: no "PaymentTypes" in response.')
        }
        if (!(jsonDataPerform.paymentTypes instanceof Array)) {
            throw new Error('Unexpected data: no "PaymentTypes" data.')
        }
        if (jsonDataPerform.paymentTypes.length === 0) {
            throw new Error(
                'No payment types available between selected accounts'
            )
        }
        if (jsonDataPerform.paymentTypes.length > 1) {
            throw new Error(
                'More than one payment types available between ' +
                    'selected accounts. Not supported yet !'
            )
        }

        // Remove any caching on accounts to catch balance changes
        this.backends.cyclos._accountsPromise = null
        this.backends.cyclos._accounts = null

        let jsonData
        try {
            jsonData = await this.backends.cyclos.$post('/self/payments', {
                amount: amount,
                description: senderMemo,
                subject: this.jsonData.cyclos.owner_id,
            })
        } catch (err) {
            if (err instanceof RequestExc.HttpError) {
                if (JSON.parse(err.data).code === 'insufficientBalance')
                    throw new e.InsufficientBalance(
                        'Transfer failed due to insufficient balance'
                    )
            }
            throw err
        }
        return new CyclosTransaction({ cyclos: this.backends.cyclos }, this, {
            cyclos: {
                ...jsonData,
                ...{
                    amount: -amount,
                    related: jsonData.to,
                    relatedUser: jsonData.toUser,
                    currency: jsonData.currency.suffix,
                }
            },
            odoo: Object.fromEntries([
                [this.jsonData.cyclos.owner_id, this.jsonData.odoo]
            ]),
        })
    }

    get internalId () {
        return `${this.parent.internalId}/${this.backends.cyclos.owner_id}`
    }

}
