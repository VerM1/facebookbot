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
    host     : '169.53.247.180',
    port     : 9123,
    user     : 'everis',
    password : 'everis123',
    database : 'asistentevirtual'
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
			if (!flag && kittenMessage(event.sender.id, event.message.text)) {
                flag = true;
			}
            if(!flag && eventsMessage(event.sender.id, event.message.text)){
                flag = true;
            }
			if(!flag && pointsMessage(event.sender.id, event.message.text)){
				flag = true;
			}
            if(!flag){
                var date = moment().format('YYYY-MM-DD HH:mm:ss');
                checkSession(event.sender.id, date).then(function(respMysql){
                    if(respMysql.length > 0){
                       /*Existe sesión válida*/
                        var watsonId = respMysql[0].watson_id;
                        var dialogStack = respMysql[0].dialog_stack;
                        obtenerWatson(event.message.text, watsonId, dialogStack).then(function(respWatson) {
                            var responseText = respWatson.output.text;
                            if( typeof responseText === 'string' ) {
                                sendMessage(event.sender.id, {text: responseText});
                            }else{
                                sendMessage(event.sender.id, {text: responseText[0]});
                            }
                            watsonId = respWatson.context.conversation_id;
                            dialogStack = respWatson.output.nodes_visited[0];
                            updateSession(event.sender.id, watsonId, dialogStack).then(function(respUpdSession){});
                        }, function(error){
                            sendMessage(event.sender.id, {text: "Error: " + event.message.text});
                        });
                    }else{
                        /*No existe sesión*/
                        var watsonId = null;
                        var dialogStack = 'root';
                        obtenerWatson(event.message.text, watsonId, dialogStack).then(function(respWatson) {
                            var responseText = respWatson.output.text;
                            if( typeof responseText === 'string' ) {
                                sendMessage(event.sender.id, {text: responseText});
                            }else{
                                sendMessage(event.sender.id, {text: responseText[0]});
                            }
                            watsonId = respWatson.context.conversation_id;
                            dialogStack = respWatson.output.nodes_visited[0];
                            newSession(event.sender.id, watsonId, dialogStack, date).then(function(respNewSession){});
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
            console.log('Error sending message1: ', error);
        } else if (response.body.error) {
            //console.log('Error sending message2: ', response.body.error);
        }
    });
};

// send rich message with kitten
function kittenMessage(recipientId, text) {
    text = text || "";
    var values = text.split(' ');
    var input = changeCase.lowerCase(values[0]);
    if (values.length === 3 && input === 'kitten') {
        if (Number(values[1]) > 0 && Number(values[2]) > 0) {
            var imageUrl = "https://placekitten.com/" + Number(values[1]) + "/" + Number(values[2]);
            message = {
                "attachment": {
                    "type": "template",
                    "payload": {
                        "template_type": "generic",
                        "elements": [{
                            "title": "Kitten",
                            "subtitle": "Cute kitten picture",
                            "image_url": imageUrl ,
                            "buttons": [{
                                "type": "web_url",
                                "url": imageUrl,
                                "title": "Show kitten"
                                }, {
                                "type": "postback",
                                "title": "	I like this",
                                "payload": "User " + recipientId + " likes kitten " + imageUrl,
                            }]
                        }]
                    }
                }
            };
            sendMessage(recipientId, message);       
            return true;
        }
    }
    return false;   
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

// send rich message with points
function pointsMessage(recipientId, text) {
    text = text || "";
    var values = text.split(' ');
    var input = changeCase.lowerCase(values[0]);
    if (values.length === 2 && input === 'puntos') {
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

/*Obtención de eventos y beneficios*/
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

/*Obtención de puntos*/
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

/*Request Watson*/
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
        uri: 'http://pruebaconversation.mybluemix.net/api/message',
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
/*MYSQL
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
    var referDate = moment().subtract(1, "hour").format('YYYY-MM-DD HH:mm:ss');
    var query = 'update session set dialog_stack = "'+dialogStack+'" where facebook_id = "'+recipientId+'" and watson_id = "'+conversationId+'" and datetime >=  "'+referDate+'"';
    console.log(query);
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
    console.log(query);
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
                    deferred.reject(err);
                }
            });
        }else{
            deferred.reject(err);
        }
        connection.release();
    });
    return deferred.promise;
}
