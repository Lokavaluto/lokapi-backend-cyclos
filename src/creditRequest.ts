import { t } from "@lokavaluto/lokapi"
import CreditRequest from "@lokavaluto/lokapi/build/backend/odoo/creditRequest"


export class CyclosCreditRequest extends CreditRequest
    implements t.ICreditRequest {

    get currency() {
        return this.jsonData.cyclos.symbol
    }

    get id() {
        return this.jsonData.comchain.hash
    }
}
