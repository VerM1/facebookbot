var cfenv = require('cfenv');
var express = require('express');
var bodyParser = require('body-parser');
var request = require('request');
var q = require('q');
var changeCase = require("change-case");
var mysql = require('mysql');
var moment = require('moment');

/*DEFAULT CONNECTIONS*/
var pool = mysql.createPool({
    connectionLimit : 5000,
    host     : process.env.DATABASE_HOST,
    port     : Number(process.env.DATABASE_PORT),
    user     : process.env.DATABASE_USER,
    password : process.env.DATABASE_PASS,
    database : process.env.DATABASE_SCHEMA
});
var app = express();

app.use(bodyParser.urlencoded({extended: false}));
app.use(bodyParser.json());
app.listen((process.env.PORT || 3000));

// Server frontpage
app.get('/', function (req, res) {
    res.send('This is TestBot Server');
});

// Facebook Webhook
app.get('/webhook', function (req, res) {
    if (req.query['hub.verify_token'] === process.env.VERIFY_TOKEN) {
        res.send(req.query['hub.challenge']);
    } else {
        res.send('Invalid verify token');
    }
});

// Metodo utilizado para la parametrización de parámetros GET
Object.toparams = function (obj) {
    var p = [];
    for (var key in obj) {
        p.push(key + '=' + encodeURIComponent(obj[key]));
    }
    return p.join('&');
};

// handler receiving messages
app.post('/webhook', function (req, res) {
    var events = req.body.entry[0].messaging;
    for (i = 0; i < events.length; i++) {
        var event = events[i];
        if (event.message && event.message.text) {
            var flag = false;
            if (!flag && eventsMessage(event.sender.id, event.message.text)) {flag = true;}
			if (!flag && pointsMessage(event.sender.id, event.message.text)) {flag = true;}
            if (!flag && offersMessage(event.sender.id, event.message.text)) {flag = true;}
            if (!flag){
                var date = moment().format('YYYY-MM-DD HH:mm:ss');
                checkSession(event.sender.id, date).then(function(respMysql){
                    if(respMysql.length > 0){
                       /*Existe sesión válida*/
                        var watsonId = respMysql[0].watson_id;
                        var dialogStack = respMysql[0].dialog_stack;
                        obtenerWatson(event.message.text, watsonId, dialogStack).then(function(respWatson) {
                            if(checkWatsonConfidence(respWatson)){
                                var responseText = respWatson.output.text;
                                if( typeof responseText === 'string' ) {sendMessage(event.sender.id, {text: responseText});}
                                else{sendMessage(event.sender.id, {text: responseText[0]});}
                                watsonId = respWatson.context.conversation_id;
                                dialogStack = respWatson.output.nodes_visited[0];
                                updateSession(event.sender.id, watsonId, dialogStack).then(function(respUpdSession){});
                            }else{
                                obtenerWikipedia(event.message.text).then(function(respWiki) {
                                    var cleanRespWiki = String(respWiki.query.search[0].snippet).replace(/<[^>]+>/gm, '').replace(/&quot;/g,'"').match(/(.{1,320})/g);
                                    for(var z = 0; z< cleanRespWiki.length; z++){
                                        sendMessage(event.sender.id, {text: cleanRespWiki[z]});
                                    }
                                }, function(error){
                                    console.log('Error Wiki: '+error);
                                });
                            }


                        }, function(error){
                            sendMessage(event.sender.id, {text: "Error: " + event.message.text});
                        });
                    }else{
                        /*No existe sesión*/
                        var watsonId = null;
                        var dialogStack = 'root';
                        obtenerWatson(event.message.text, watsonId, dialogStack).then(function(respWatson) {
                            if(checkWatsonConfidence(respWatson)){
                                var responseText = respWatson.output.text;
                                if( typeof responseText === 'string' ) {sendMessage(event.sender.id, {text: responseText});}
                                else{sendMessage(event.sender.id, {text: responseText[0]});}
                                watsonId = respWatson.context.conversation_id;
                                dialogStack = respWatson.output.nodes_visited[0];
                                newSession(event.sender.id, watsonId, dialogStack, date).then(function(respNewSession){});
                            }else{
                                obtenerWikipedia(event.message.text).then(function(respWiki) {
                                    var cleanRespWiki = String(respWiki.query.search[0].snippet).replace(/<[^>]+>/gm, '').replace(/&quot;/g,'"').match(/(.{1,320})/g);
                                    for(var z = 0; z< cleanRespWiki.length; z++){
                                        sendMessage(event.sender.id, {text: cleanRespWiki[z]});
                                    }
                                }, function(error){
                                    console.log('Error Wiki: '+error);
                                });
                            }
                        }, function(error){
                            sendMessage(event.sender.id, {text: "Error: " + event.message.text});
                        });
                    }
                }, function(error){
                    console.log('mysql error: '+error);
                });
            }
		}else if (event.postback) {
			console.log("Postback received: " + JSON.stringify(event.postback));
		}	
    }
    res.sendStatus(200);
});

// generic function sending messages
function sendMessage(recipientId, message) {
    request({
        url: 'https://graph.facebook.com/v2.6/me/messages',
        qs: {access_token: process.env.PAGE_ACCESS_TOKEN},
        method: 'POST',
        json: {
            recipient: {id: recipientId},
            message: message,
        }
    }, function(error, response, body) {
        if (error) {
            console.log('I. Error sending message: ', error);
        } else if (response.body.error) {
            console.log('II. Error sending message: ', response.body.error);
        }
    });
};

// send rich message with events
function eventsMessage(recipientId, text) {
    text = text || "";
    var values = text.split(' ');
    var input = changeCase.lowerCase(values[0]);
    if (input === '#eventos' || input === '#beneficios') {
		var benefit = (input === '#eventos') ? 'events' : 'discounts';
        obtenerBenecifiosEventos(benefit).then(function(response) {
            var totalEventos = (input === '#eventos') ? response.datos.eventos.length : response.datos.descuentos.length;
            for(var i = 0; i < totalEventos; i++){
                var evento = (input === '#eventos') ? response.datos.eventos[i] :  response.datos.descuentos[i];
                var nombreEvento = evento.marca;
                var imageUrl = evento.imagen_mobile;
                var greatImageUrl = evento.imagen_destacado_mobile;
				var textoPromocion = evento.texto_promocion;
				
                var message = {
                    "attachment": {
                        "type": "template",
                        "payload": {
                            "template_type": "generic",
                            "elements": [{
                                "title": "Evento",
                                "subtitle": nombreEvento + ' - ' + textoPromocion,
                                "image_url": imageUrl ,
                                "buttons": [{
                                    "type": "web_url",
                                    "url": greatImageUrl,
                                    "title": "Ver Detalle"
                                }, {
                                    "type": "postback",
                                    "title": "Me gusta",
                                    "payload": "Al usuario " + recipientId + " le gusta el evento " + nombreEvento,
                                }]
                            }]
                        }
                    }
                };
                sendMessage(recipientId, message);
            }
        }, function(error){
            console.log("Promise error: "+error);
        });
        return true;
    }
    return false;
};


function offersMessage(recipientId, text){
    text = text || "";
    var values = text.split(' ');
    var input = changeCase.lowerCase(values[0]);
    var inputData = input.split('-');
    if(inputData[0] === '#bolsa'){
        if(inputData[1] === 'sms' || inputData[1] === 'internet' || inputData[1] === 'mixta'){
            obtenerOfertas(inputData[1]).then(function(response) {
                for(var i = 0; i < response.datos.ofertas.length; i++){
                    var descripcion = response.datos.ofertas[i].descripcionWeb;
                    var valor = response.datos.ofertas[i].cargoBasico;
                    sendMessage(recipientId, {
                        text: (i+1)+'. '+descripcion+ ' Con un valor de: $'+valor}
                    );
                }
            }, function(error){
                console.log("Promise error: "+error);
            });
            return true;
        }
    }
    return false;
}

// send rich message with points
function pointsMessage(recipientId, text) {
    text = text || "";
    var values = text.split(' ');
    var input = changeCase.lowerCase(values[0]);
    if (values.length === 2 && input === '#puntos') {
		var rut = changeCase.upperCase(values[1]);
        obtenerPuntos(rut).then(function(response) {
            var puntos = response;
			sendMessage(recipientId, {text: 'Tus puntos actuales son ' + puntos.datos.saldoActual+', de los cuales '+puntos.datos.saldoPorVencer+' vencerán el '+puntos.datos.fechaSaldoPorVencer});
        }, function(error){
            console.log("Promise error: "+error);
        });
        return true;
    }
    return false;
};

/*APIGEE SECTION
* */
var obtenerBenecifiosEventos = function(id) {
    var defer = q.defer();
    var header = {
        Authorization: process.env.APIGEE_AUTHORIZATION,
        'Content-Type' : 'application/x-www-form-urlencoded'
    };
    var options = {
        uri: 'https://api.movistar.cl/catalog/V2/loyalty/benefits/'+id+'?apikey='+process.env.APIGEE_APIKEY,
        method: 'GET',
        headers : header
    };
    clienteWs(options).then(function(response) {
        defer.resolve(response);
    }, function(error){
        defer.reject(error);
        console.log('Promise Rejected!', error);
    });
    return defer.promise;
};

var obtenerOfertas = function(type){
    var familia = '';
    if(type=='sms'){familia = 9;
    }else if(type=='internet'){familia = 12;
    }else if(type=='mixta'){familia = 10;}

    var defer = q.defer();
    var header = {
        Authorization: process.env.APIGEE_AUTHORIZATION,
        'Content-Type' : 'application/x-www-form-urlencoded'
    };
    var options = {
        uri: 'https://api.movistar.cl/offer/V2/feasibleOffer/56994512108?contractType=Contrato&family='+familia+'&plainCode=7R4&services=bolsa&type=mobile&apikey='+process.env.APIGEE_APIKEY,
        method: 'GET',
        headers : header
    };
    clienteWs(options).then(function(response) {
        defer.resolve(response);
    }, function(error){
        defer.reject(error);
        console.log('Promise Rejected!', error);
    });
    return defer.promise;
}
var obtenerPuntos = function(rut) {
    var defer = q.defer();
    var header = {
        Authorization: process.env.APIGEE_AUTHORIZATION,
        'Content-Type' : 'application/x-www-form-urlencoded'
    };
    var options = {
        uri: 'https://api.movistar.cl/loyalty/V2/balance/'+rut+'?apikey='+process.env.APIGEE_APIKEY,
        method: 'GET',
        headers : header
    };
    clienteWs(options).then(function(response) {
        defer.resolve(response);
    }, function(error){
        defer.reject(error);
        console.log('Promise Rejected!', error);
    });
    return defer.promise;
};

/*WATSON SECTION
* */
var checkWatsonConfidence = function(response){
    var confidence = (response.intents[0].confidence < 0.5) ? false : true;
    return confidence;
};

var obtenerWatson = function(text, watsonId, dialogStack) {
    var defer = q.defer();
    var data = '';
    if(watsonId == null){
        var data = {'input':{'text': text}};
    }else{
        data = {'input':{'text': text},'context':{'conversation_id': watsonId, 'system': {'dialog_stack': [dialogStack]}}};
    }
    var header = {
        'Content-Type' : 'application/json'
    };
    var options = {
        uri: process.env.BLUEMIX_ENDPOINT,
        method: 'POST',
        headers : header,
        json: data
    };
    clienteWsPayload(options).then(function(response) {
        defer.resolve(response);
    }, function(error){
        defer.reject(error);
        console.log('Promise Rejected!', error);
    });
    return defer.promise;
};

var obtenerWikipedia = function(text){
    var defer = q.defer();
    var header = {
        'Content-Type' : 'application/x-www-form-urlencoded'
    };
    var options = {
        uri: 'https://es.wikipedia.org/w/api.php?action=query&format=json&srprop=snippet&list=search&titles=&srsearch='+text,
        method: 'POST',
        headers : header
    };
    console.log(options.uri);
    clienteWs(options).then(function(response) {
        defer.resolve(response);
    }, function(error){
        defer.reject(error);
        console.log('Promise Rejected!', error);
    });
    return defer.promise;
}

var clienteWs = function(options){
    var deferred = q.defer();
    request(options, function (error, salida) {
        try {
            var response = JSON.parse(salida.body);
            deferred.resolve(response);
        }catch(error){
            var response = salida.body;
            deferred.reject(error);
        }
    });
    return deferred.promise;
}

var clienteWsPayload = function(options){
    var deferred = q.defer();
    request(options, function (error, salida) {
        try {
            var response = salida.body;
            deferred.resolve(response);
        }catch(error){
            deferred.reject(error);
        }
    });
    return deferred.promise;
}

/*MYSQL SECTION
* */
var newSession = function (recipientId, conversationId, dialogStack, datetime){
    var defer = q.defer();
    var query = 'insert into session (facebook_id, watson_id, dialog_stack, datetime) values ("'+recipientId+'","'+conversationId+'","'+dialogStack+'","'+datetime+'")';
    clienteMysql(query).then(function(response) {
        defer.resolve(response);
    }, function(error){
        defer.reject(error);
    });
    return defer.promise
}
var updateSession = function (recipientId, conversationId, dialogStack){
    var defer = q.defer();
	var date = moment().format('YYYY-MM-DD HH:mm:ss');
    var referDate = moment().subtract(1, "hour").format('YYYY-MM-DD HH:mm:ss');
    var query = 'update session set dialog_stack = "'+dialogStack+'", datetime = "'+date+'" where facebook_id = "'+recipientId+'" and watson_id = "'+conversationId+'" and datetime >=  "'+referDate+'"';
    clienteMysql(query).then(function(response) {
        defer.resolve(response);
    }, function(error){
        defer.reject(error);
    });
    return defer.promise;
}
var checkSession = function (recipientId, date){
    var defer = q.defer();
    var referDate = moment().subtract(1, "hour").format('YYYY-MM-DD HH:mm:ss');
    var query = 'select facebook_id, watson_id, dialog_stack, datetime from session where facebook_id = "'+recipientId+'" and datetime >=  "'+referDate+'" order by id desc';
    clienteMysql(query).then(function(response) {
        defer.resolve(response);
    }, function(error){
        defer.reject(error);
    });
    return defer.promise;
}

var clienteMysql = function(query){
    var deferred = q.defer();
    pool.getConnection(function(err, connection){
        if(!err){
            connection.query(query, function(error, rows) {
                if(!error){
                    deferred.resolve(rows);
                }else{
                    deferred.reject(error);
                }
            });
        }else{
            deferred.reject(err);
        }
        try {
            connection.release();
        }
        catch(err) {
            console.log('Error: '+err.message);
        }
    });
    return deferred.promise;
}
