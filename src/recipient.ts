import { t, e } from '@lokavaluto/lokapi'
import Recipient from '@lokavaluto/lokapi/build/backend/odoo/recipient'
import { PlannedTransaction } from '@lokavaluto/lokapi/build/backend/odoo/transaction'

import { e as RequestExc } from '@0k/types-request'

import { CyclosTransaction } from './transaction'


export class CyclosRecipient extends Recipient implements t.IRecipient {

    get backendId () {
        return this.parent.internalId
    }

    get fromUserAccount () {
        return this.backends.cyclos
    }

    get userAccountInternalId () {
        // XXXvlab: should be the second
        return `cyclos:${this.jsonData.cyclos.owner_id}`
        //return `${this.backendId}/user/${this.jsonData.cyclos.owner_id}`
    }

    getSymbol () {
        return this.fromUserAccount.getSymbol()
    }


    public async prepareTransfer (
        amount: string,
        senderMemo: string,
        recipientMemo: string = senderMemo
    ) {
        return [new PlannedTransaction({
            amount,
            description: senderMemo,
            related: this.name,
            tags: ["collateralized"],
            executeData: {
                fn: this.transferFn.bind(this),
                args: [
                    amount,
                    senderMemo,
                    recipientMemo
                ]
            }
        })]
    }

    public async transferFn (
        amount: number,
        senderMemo: string,
        recipientMemo: string = senderMemo
    ) {
        let userAccount = this.fromUserAccount
        let backendCyclos = this.fromUserAccount.backends.cyclos

        if (senderMemo !== recipientMemo)
            throw Error(
                "Cyclos backend doesn't support split memo on transfer yet."
            )

        const jsonDataPerform = await backendCyclos.$get(
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
        userAccount._accountsPromise = null
        userAccount._accounts = null

        let jsonData
        try {
            jsonData = await backendCyclos.$post('/self/payments', {
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
        let reconversionStatusResolve = {}
        reconversionStatusResolve[`${this.backendId}/tx/${jsonData.id}`] = false
        return new CyclosTransaction(userAccount.backends, this, {
            cyclos: {
                ...jsonData,
                ...{
                    amount: -amount,
                    related: jsonData.to,
                    relatedUser: jsonData.toUser,
                    currency: jsonData.currency.suffix,
                }
            },
            odoo: {
                addressResolve: Object.fromEntries([
                    [this.jsonData.cyclos.owner_id, this.jsonData.odoo]
                ]),
                reconversionStatusResolve,
            }
        })
    }

    get internalId () {
        return `${this.parent.internalId}/${this.backends.cyclos.owner_id}`
    }

    public async isBusinessForFinanceBackend () {
        // XXXvlab: not yet implemented
        return false
    }

}
