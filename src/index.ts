import { JsonRESTPersistentClientAbstract } from '@lokavaluto/lokapi/build/rest'
import { t, e, RestExc } from '@lokavaluto/lokapi'
import { mux } from '@lokavaluto/lokapi/build/generator'
import { BackendAbstract } from '@lokavaluto/lokapi/build/backend'

import { CyclosAccount } from './account'
import { CyclosRecipient } from './recipient'
import { CyclosTransaction } from './transaction'


interface IJsonDataWithOwner extends t.JsonData {
    owner_id: string
}


export default abstract class CyclosBackendAbstract extends BackendAbstract {

    private getSubBackend (jsonData: IJsonDataWithOwner) {
        const {
            httpRequest,
            base64Encode,
            persistentStore,
            requestLogin,
        } = this
        class CyclosUserAccount extends CyclosUserAccountAbstract {
            httpRequest = httpRequest
            base64Encode = base64Encode
            persistentStore = persistentStore
            requestLogin = requestLogin

            // This function declaration seems necessary for typescript
            // to avoid having issues with this dynamic abstract class
            constructor (
                backends: { [index: string]: t.IBackend },
                jsonData: IJsonDataWithOwner
            ) {
                super(backends, jsonData)
            }
        }
        return new CyclosUserAccount(this.backends, jsonData)
    }

    private get userAccounts () {
        if (!this._userAccounts) {
            this._userAccounts = {}
            this.jsonData.accounts.forEach(
                (userAccountData: IJsonDataWithOwner) => {
                    const cyclosUserAccount = this.getSubBackend(
                        userAccountData
                    )
                    this._userAccounts[
                        cyclosUserAccount.internalId
                    ] = cyclosUserAccount
                }
            )
        }
        return this._userAccounts
    }

    private _userAccounts: any


    public async getAccounts (): Promise<any> {
        const backendBankAccounts = []
        for (const id in this.userAccounts) {
            const userAccount = this.userAccounts[id]
            const bankAccounts = await userAccount.getAccounts()
            bankAccounts.forEach((bankAccount: any) => {
                backendBankAccounts.push(bankAccount)
            })
        }
        return backendBankAccounts
    }


    public makeRecipients (jsonData: t.JsonData): t.IRecipient[] {
        const recipients = []
        if (Object.keys(this.userAccounts).length === 0) {
            throw new Error(
                'Current user has no account in cyclos. Unsupported yet.'
            )
        }
        if (Object.keys(this.userAccounts).length > 1) {
            // We will need to select one of the source userAccount of the
            // current logged in user
            throw new Error(
                'Current user has more than one account in cyclos. ' +
                    'Unsupported yet.'
            )
        }
        jsonData.monujo_backends[this.internalId].forEach((ownerId: string) => {
            // Each ownerId here is a different account in cyclos for recipient
            recipients.push(
                new CyclosRecipient(
                    {
                        cyclos: Object.values(this.userAccounts)[0],
                        ...this.backends,
                    },
                    this,
                    {
                        odoo: jsonData,
                        cyclos: { owner_id: ownerId },
                    }
                )
            )
        })
        return recipients
    }

    public async * getTransactions (order): AsyncGenerator {
        yield * mux(
            Object.values(this.userAccounts).map(
                (u: CyclosUserAccountAbstract) => u.getTransactions(order)),
            order
        )
    }

}


abstract class CyclosUserAccountAbstract extends JsonRESTPersistentClientAbstract {

    AUTH_HEADER = 'Session-token'

    ownerId: string
    backends: { [index: string]: t.IBackend }

    constructor (backends, jsonData) {
        super(jsonData.url)
        this.lazySetApiToken(jsonData.token)
        this.ownerId = jsonData.owner_id
        this.backends = backends
    }

    async getAccounts () {
        const jsonAccounts = await this.$get(`/${this.ownerId}/accounts`)
        const accounts = []
        jsonAccounts.forEach((jsonAccountData: any) => {
            accounts.push(
                new CyclosAccount({ cyclos: this, ...this.backends }, this, {
                    cyclos: jsonAccountData,
                })
            )
        })
        return accounts
    }

    get internalId () {
        return `cyclos:${this.ownerId}@${this.host}`
    }

    public async * getTransactions (order): AsyncGenerator {
        let responseHeaders: {[k:string]: string}
        let page = 0
        let jsonTransactions: any

        while (true) {
            responseHeaders = {}
            jsonTransactions = await this.$get(
                `/${this.ownerId}/transactions`, { page },
                {}, responseHeaders
            )
            for (let idx = 0; idx < jsonTransactions.length; idx++) {
                yield new CyclosTransaction(
                    { cyclos: this, ...this.backends },
                    this,
                    { cyclos: jsonTransactions[idx] }
                )
            }
            if (responseHeaders['x-has-next-page'] === 'false') {
                return
            }
            page++
        }
    }

    public async request (path: string, opts: t.HttpOpts): Promise<any> {
        let response: any
        try {
            response = await super.request(path, opts)
        } catch (err) {
            if (err instanceof RestExc.HttpError && err.code === 401) {
                let errCode: string
                try {
                    const data = JSON.parse(err.data)
                    errCode = data.code
                } catch (err2) {
                    console.log(
                        'Could not get error code from JSON request body',
                        err2
                    )
                    throw err
                }
                if (errCode === 'loggedOut') {
                    console.log('Cyclos Authentication Required')
                    throw new RestExc.AuthenticationRequired(
                        err.code, 'Authentication Failed',
                        err.data, err.response)
                }
            }
            throw err
        }
        return response
    }

}
