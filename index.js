var express = require('express');
var bodyParser = require('body-parser');
var request = require('request');
var Client = require('node-rest-client').Client;

var app = express();
var client = new Client();

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
                console.log("Servicio Eventos***: "+servicioEventos());
				sendMessage(event.sender.id, {text: "Echo: " + event.message.text});
			}
		}else if (event.postback) {
			console.log("Postback received: " + JSON.stringify(event.postback));
		}	
    }
    res.sendStatus(200);
});

// handling client error events
client.on('error', function (err) {
    console.error('Something went wrong on the client', err);
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
            console.log('Error2: ', response.body.error);
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



function servicioEventos(){
    var endpoint = "https://api.movistar.cl/catalog/V2/loyalty/benefits/${id}?apikey=";
    var args = {
        path: { "id": "events" },
        parameters: { apikey: "w8kfm8dYR59V3Ithu6mw3CTUhD9bGhzv"},
        headers: { "Authorization": "Basic ZXZlcmlzOmV2ZXJpc2FwcHNAdGVsZWZvbmljYS5jb20=", "Content-type": "application/json" }
    };
    return apigeeClient(endpoint, args);
}
function apigeeClient(endpoint, args){
    client.get(endpoint, args, function (data, response) {
        //console.log(data);
        console.log("RESPONSE:"+response.data.datos);
        return response;
    }).on('error', function (err) {
        console.log("Error 1: "+err);
        console.log('something went wrong on the request', err.request.options);
    });
}

