import { e as HttpRequestExc } from '@0k.io/types-request'

import { JsonRESTPersistentClientAbstract } from '@lokavaluto/lokapi/build/rest'
import { t, RestExc } from '@lokavaluto/lokapi'
import { mux } from '@lokavaluto/lokapi/build/generator'
import { BackendAbstract } from '@lokavaluto/lokapi/build/backend'

import { CyclosAccount } from './account'
import { CyclosRecipient } from './recipient'
import { CyclosTransaction, getRelatedId } from './transaction'


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
                parent: BackendAbstract,
                jsonData: IJsonDataWithOwner
            ) {
                super(backends, parent, jsonData)
            }
        }
        return new CyclosUserAccount(this.backends, this, jsonData)
    }

    public get userAccounts () {
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

    public async * getTransactions (opts: any): AsyncGenerator {
        yield * CyclosTransaction.mux(
            Object.values(this.userAccounts).map(
                (u: CyclosUserAccountAbstract) => u.getTransactions(opts)
            ),
            opts?.order || ['-date']
        )
    }

}


abstract class CyclosUserAccountAbstract extends JsonRESTPersistentClientAbstract {

    AUTH_HEADER = 'Session-token'

    parent: BackendAbstract
    ownerId: string
    backends: { [index: string]: t.IBackend }
    jsonData: { [index: string]: any }

    constructor (backends, parent, jsonData) {
        super(jsonData.url)
        this.parent = parent
        this.lazySetApiToken(jsonData.token)
        this.ownerId = jsonData.owner_id
        this.backends = backends
        this.jsonData = jsonData
    }

    public get active () {
        return this.jsonData.active
    }

    _accounts: Array<CyclosAccount> | null = null
    _accountsPromise: Promise<Array<CyclosAccount>> | null = null
    async getAccounts () {
        if (!this._accounts) {
            if (!this._accountsPromise) {
                const self = this
                let _accountsPromise: Promise<any>
                _accountsPromise = (async () => {
                    if (!self.active) return []

                    const jsonAccounts = await self.$get(
                        `/${self.ownerId}/accounts`
                    )
                    const accounts = []
                    jsonAccounts.forEach((jsonAccountData: any) => {
                        accounts.push(
                            new CyclosAccount(
                                { cyclos: self, ...self.backends },
                                self,
                                {
                                    cyclos: jsonAccountData,
                                }
                            )
                        )
                    })
                    self._accounts = accounts
                })()
                this._accountsPromise = _accountsPromise
            }
            await this._accountsPromise
        }
        return this._accounts
    }

    async getSymbol () {
        let bankAccounts = await this.getAccounts()

        if (Object.keys(bankAccounts).length === 0) {
            throw new Error(
                'Current user account has no bank accounts in cyclos. Unsupported yet.'
            )
        }
        if (Object.keys(bankAccounts).length > 1) {
            // We will need to select one of the source userAccount of the
            // current logged in user
            throw new Error(
                'Current user account has more than one bank account in cyclos. ' +
                    'Unsupported yet.'
            )
        }
        return await bankAccounts[0].getSymbol()
    }

    get internalId () {
        return `cyclos:${this.ownerId}@${this.host}`
    }

    public async requiresUnlock () {
        return false
    }

    public async * getTransactions (opts: any): AsyncGenerator {
        if (!this.active) return
        const order = opts?.order || ['-date']
        if (order.length > 1) {
            throw new Error('Multiple order keys not supported yet.')
        }
        let orderStr = order[0]
        let direction = 'Asc'
        if (orderStr.startsWith('-')) {
            orderStr = orderStr.substring(1)
            direction = 'Desc'
        } else if (orderStr.startsWith('+')) {
            orderStr = orderStr.substring(1)
        }
        if (!['date', 'amount'].includes(orderStr)) {
            throw new Error(
                `Invalid sort key '${orderStr}'. ` +
                    "Only value supported is 'date' or 'amount'."
            )
        }

        const orderBy = `${orderStr}${direction}`
        let datePeriod = null
        switch (
            [opts?.dateBegin, opts?.dateEnd]
                .map((x) => (x ? '1' : '0'))
                .join('')
        ) {
            case '10':
                datePeriod = [opts.dateBegin.toISOString()]
                break
            case '01':
                datePeriod = [',' + opts.dateEnd.toISOString()]
                break
            case '11':
                datePeriod = [opts.dateBegin, opts.dateEnd]
                    .map((d) => d.toISOString())
                    .join(',')
                break
        }
        let responseHeaders: { [k: string]: string }
        let page = 0
        let transactionsData: any
        const addressResolve = {}
        while (true) {
            responseHeaders = {}
            transactionsData = await this.$get(
                `/${this.ownerId}/transactions`,
                {
                    page,
                    orderBy,
                    ...(datePeriod && { datePeriod }),
                },
                {},
                responseHeaders
            )
            const uniqueAddresses = transactionsData
                .map(getRelatedId)
                .filter(
                    (t: any, idx: number, self) =>
                        self.indexOf(t) === idx &&
                        typeof addressResolve[t] === 'undefined' &&
                        t !== 'Admin'
                )
            if (uniqueAddresses.length > 0) {
                const contacts = await this.backends.odoo.$post(
                    '/cyclos/contact',
                    {
                        addresses: uniqueAddresses,
                    }
                )
                for (const k in contacts) {
                    addressResolve[k] = contacts[k]
                }
            }

            for (let idx = 0; idx < transactionsData.length; idx++) {
                yield new CyclosTransaction(
                    { cyclos: this, ...this.backends },
                    this,
                    {
                        cyclos: transactionsData[idx],
                        odoo: addressResolve,
                    }
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
            if (err instanceof HttpRequestExc.HttpError && err.code === 401) {
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
                        err.code,
                        'Authentication Failed',
                        err.data,
                        err.response
                    )
                }
            }
            throw err
        }
        return response
    }
}
