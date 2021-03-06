import NodesList from 'node/lists/Nodes-List';
import consts from "consts/const_global"

const MAX_TRANSACTIONS_LENGTH = 5000;

class TransactionsDownloadManager{

    constructor(blockchain, transactionsProtocol){

        this.blockchain = blockchain;
        this.transactionsProtocol = transactionsProtocol;

        this._socketsQueue = [];
        this._transactionsQueue = [];

        NodesList.emitter.on("nodes-list/disconnected", (result) => {
            this._unsubscribeSocket(result.socket)
        });

        setTimeout( this._processSockets.bind(this), 5000 );
        setTimeout( this._processTransactions.bind(this), 2*1000 );
        setTimeout( this._deleteOldTransactions.bind(this), 2*60*1000 );

    }

    findSocket(socket, returnPos = false){

        for (let i=0; i<this._socketsQueue.length; i++)
            if (this._socketsQueue[i] === socket)
                return returnPos ? i :  this._socketsQueue[i];

        return returnPos ? -1 : null;
    }

    addSocket(socket){

        if (this.findSocket(socket) === null)
            this._socketsQueue.push(socket);

    }

    findTransactionById(txId, returnPos){

        for (let i=0; i<this._transactionsQueue.length; i++)
            if (this._transactionsQueue[i].txId.equals(txId))
                return returnPos ? i :  this._transactionsQueue[i];

        return returnPos ? -1 : null;

    }

    addTransaction(socket, txId, buffer){

        if ( !Buffer.isBuffer(txId) ) throw {message: "txId is not a buffer"};

        if (this._transactionsQueue.length > MAX_TRANSACTIONS_LENGTH){
            console.warn("There are way too many transactions in pending");
            return false; //too many;
        }

        let transactionFound = this.findTransactionById(txId);
        if ( transactionFound  === null) {

            this._transactionsQueue.push({
                txId: txId,
                buffer: buffer,
                socket: socket,
                dateInitial: new Date().getTime(),
                deleted: false,
            });

            return true;

        } else {

            transactionFound.socket = socket;

        }

        return false;
    }

    async _processSockets(){

        try{

            for (let i=0; i < 20; i++){

                let socket;
                if (this._socketsQueue.length > 0) {
                    socket = this._socketsQueue[0];
                    this._socketsQueue.splice(0,1);
                }

                if (socket !== undefined)
                    await this.transactionsProtocol.downloadTransactions(socket, 0, 40, consts.SETTINGS.MEM_POOL.MAXIMUM_TRANSACTIONS_TO_DOWNLOAD );

            }

        } catch (exception){

        }

        setTimeout( this._processSockets.bind(this), 2000 );

    }

    _findFirstUndeletedTransaction(socketsAlready = []){

        for (let i=0; i < this._transactionsQueue.length; i++)
            if ( !this._transactionsQueue[i].deleted && this._transactionsQueue[i].socket !== undefined ) {

                let found = false;
                for ( let j=0; j < socketsAlready.length; j++ )
                    if (socketsAlready[j] === this._transactionsQueue[i].socket){
                        found = true;
                        break;
                    }

                if (found)
                    continue;

                return i;
            }

        return -1;

    }

    async _processTransactions(){

        let socketsAlready = [];
        for (let count = 0; count < 20; count++){

            try{

                let pos = this._findFirstUndeletedTransaction(socketsAlready);

                let tx;
                if (pos !== -1)
                    tx = this._transactionsQueue[pos];

                if (tx !== undefined) {

                    console.info("processing transaction ", pos, "/", this._transactionsQueue.length, tx.txId.toString("hex"));

                    let transaction;

                    try {

                        if ( tx.buffer === undefined )
                            tx.buffer = await this.transactionsProtocol.downloadTransaction(tx.socket, tx.txId );

                        if (Buffer.isBuffer(tx.buffer))
                            transaction = this._createTransaction(tx.buffer, tx.socket);

                    } catch (exception){

                    }

                    this._transactionsQueue[pos].deleted = true;

                    tx.buffer = undefined;

                    if (tx.socket !== undefined)
                        socketsAlready.push( tx.socket );

                }

            } catch (exception){
                console.error("_processTransactions raised an error", exception);
            }

        }

        setTimeout( this._processTransactions.bind(this), 300);

    }

    _deleteOldTransactions(){

        let date = new Date().getTime();

        try {

            for (let i = this._transactionsQueue.length - 1; i >= 0; i--)
                if ( ( (date - this._transactionsQueue[i].dateInitial) > 4 * 60 * 60 * 1000) && this._transactionsQueue[i].deleted )
                    this._transactionsQueue.splice(i, 1);

        } catch (exception){
            console.error("_deleteOldTransactions raised an error", exception);
        }

        setTimeout( this._deleteOldTransactions.bind(this), 2*60*1000 );
    }

    _createTransaction(buffer, socket){

        let transaction;
        try {

            transaction = this.blockchain.transactions._createTransactionFromBuffer( buffer ).transaction;

            if (!this.blockchain.mining.miningTransactionSelector.validateTransaction(transaction))
                throw {message: "validation failed"};

            if (!transaction.isTransactionOK(true, false))  //not good
                throw {message: "transaction is invalid"};

            this.blockchain.transactions.pendingQueue.includePendingTransaction(transaction, socket);

            return transaction
        } catch (exception) {

            if (transaction !== undefined && transaction !== null)
                if (this.blockchain.transactions.pendingQueue.findPendingTransaction(transaction) === -1)
                    transaction.destroyTransaction();

        }

        return null;

    }

    _unsubscribeSocket(socket){

        for (let i = this._socketsQueue.length-1; i >= 0; i--)
            if (this._socketsQueue[i] === socket)
                this._socketsQueue.splice(i, 1);

        for (let i=this._transactionsQueue.length-1; i  >= 0; i--)
            if ( this._transactionsQueue[i].socket === socket) {
                this._transactionsQueue[i].socket = undefined;

                // if (!this._transactionsQueue[i].deleted) {
                //     this._transactionsQueue[i].deleted = true;
                //     this._transactionsQueue.splice(i, 1);
                // }

            }

    }

}

export default TransactionsDownloadManager;