var express = require('express');
var bodyParser = require('body-parser');
var request = require('request');

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
    if (req.query['hub.verify_token'] === 'token_de_validacion_movistar') {
        res.send(req.query['hub.challenge']);
    } else {
        res.send('Invalid verify token');
    }
});

// handler receiving messages
app.post('/webhook', function (req, res) {
    var events = req.body.entry[0].messaging;
    for (i = 0; i < events.length; i++) {
        var event = events[i];
        if (event.message && event.message.text) {
			if (!kittenMessage(event.sender.id, event.message.text)) {
                var values = event.message.text.split(' ');
                if(values[0] === 'eventos'){
                    var eventos = obtenerBenecifiosEventos('id');
                    console.log(eventos);
                    /*
                    console.log("Total eventos: *" +eventos.datos.eventos.length);
                    for(i = 0; i < eventos.datos.eventos.length; i++){
                        console.log(eventos.datos.eventos[i].marca);
                    }*/
                }else{
                    sendMessage(event.sender.id, {text: "Echo: " + event.message.text});
                }
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
            console.log('Error sending message: ', error);
        } else if (response.body.error) {
            console.log('Error: ', response.body.error);
        }
    });
};

// send rich message with kitten
function kittenMessage(recipientId, text) {
    text = text || "";
    var values = text.split(' ');
    if (values.length === 3 && values[0] === 'kitten') {
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

var obtenerBenecifiosEventos = function(id) {

    var header = {
        Authorization: "Basic ZXZlcmlzOmV2ZXJpc2FwcHNAdGVsZWZvbmljYS5jb20=",
        'Content-Type' : 'application/json'
    };
    var options = {
        uri: 'https://api.movistar.cl/catalog/V2/loyalty/benefits/events?apikey=w8kfm8dYR59V3Ithu6mw3CTUhD9bGhzv',
        method: 'GET',
        headers : header
    };
    var cliente = clienteApigee(options);
    return cliente
};


function clienteApigee(options){
    request(options, function (error, salida) {
        try {
            var response = salida.body;
            console.log('Response Bueno Apigee',response);
            return response;
        }catch(error){
            var response = salida.body;
            console.log('Response Malo Apigee',response);
            return response;
        }
    });
}