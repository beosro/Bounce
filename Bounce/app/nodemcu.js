// NodeMCU Handler
goog.provide('bounce.Nodemcu');
goog.provide('bounce.Nodemcu.scan');

goog.require('goog.string');
goog.require('goog.async.Delay');


// Utility bits

var array_buffer_to_string = function(buffer_data) {
    return String.fromCharCode.apply(null, new Uint8Array(buffer_data));
};

var string_to_array_buffer = function(string_data) {
    var buf=new ArrayBuffer(string_data.length);
    var bufView=new Uint8Array(buf);
    for (var i=0; i<string_data.length; i++) {
        bufView[i]=string_data.charCodeAt(i);
  }
  return buf;
};

/**
 * Class to handle the interactions with the NodeMCU device
 *
 * @param output_console to write output to
 * @param serial_port_path The serial port to make this with.
 *
 * @constructor
 */
bounce.Nodemcu = function(serial_port_path, output_console) {
    this.port = serial_port_path;
    var _connection_info = null; //If connected - the chrome connection info.
    var _received_str = '';
    var _node_instance = this;

    /**
     * Register a an event for a line of text received.
     * Note - stuff like prompts, do not come as a line!
     *
     * @param listener
     */
    this.addLineEventListener = function(listener) {
        document.addEventListener('line_received', listener, false);
    };

    this._fire_line_received_event = function(line) {
        var event = new CustomEvent('line_received', {'detail': {node: _node_instance, line: line}});
        document.dispatchEvent(event);
    };

    /**
     * Listener for data - assembling into lines.
     * @param info
     * @private
     */
    function _data_received(info) {
        if(info.connectionId == _connection_info.connectionId && info.data) {
            var str = array_buffer_to_string(info.data);
            output_console.write(str);
            if (str.charAt(str.length-1) === '\n') {
                _received_str += str.substring(0, str.length-1);
                _node_instance._fire_line_received_event(_received_str);
                _received_str = '';
            } else {
                _received_str += str;
            }
        }
    }

    function _setup_data_listener() {
        chrome.serial.onReceive.addListener(_data_received);
    }

    this.connect = function (connected_callback) {
        function connected_inner(connectionInfo) {
            _connection_info = connectionInfo;
            _setup_data_listener();
            connected_callback(_node_instance);
        }
        output_console.writeLine("Connecting to device on " + serial_port_path);
        chrome.serial.connect(serial_port_path, {bitrate: 9600}, connected_inner);
    };

    this.disconnect = function(disconnected_calback) {
        output_console.writeLine("Disconnecting");
        chrome.serial.onReceive.removeListener(_data_received);
        chrome.serial.disconnect(_connection_info.connectionId, disconnected_calback);
    };

    /**
     * Send data as a single chunk to the micro
     *
     * @param data Data to send to the device. Always flushed for now.
     * @param sent_callback Called when data was sent and flushed.
     */
    this.send_data = function(data, sent_callback) {
        // Send, flush when done, then perform the callback after this.
        chrome.serial.send(_connection_info.connectionId, string_to_array_buffer(data), function(){
            chrome.serial.flush(_connection_info.connectionId, function() {
                sent_callback && sent_callback();
            });
        });
    };

    /**
     * Send data a line at a time to the micro
     *
     * @param data                  Multiline chunk of text to send
     * @param completed_callback    Call this when done
     */
    this.send_multiline_data = function(data, completed_callback) {
        var lines = data.split("\n");
        var current_line = 0;
        // Send each one, with the sent callback priming the next.
        function _send_next() {
            if (current_line < lines.length) {
                _node_instance.send_data(lines[current_line++] + "\n", function() {});
            } else {
                chrome.serial.onReceive.removeListener(_send_next);
                completed_callback();
            }
        }

        chrome.serial.onReceive.addListener(function(info) {
            console.log("Received call. Info data is ", JSON.stringify(info));
            var data = array_buffer_to_string(info.data);
            console.log('Data was :', JSON.stringify(data));
            if(info.connectionId == _connection_info.connectionId && goog.string.endsWith(data, "> ")) {
                _send_next();
            }
        });

        _send_next();
    };

    /**
     * Send a block of code - save it under the given filename on the device.
     *
     * @param  data     - Data to send
     * @param filename  - Filename to store on the device as
     * @param completed_callback    - Function call when all sent.
     */
    this.send_as_file= function(data, filename, completed_callback) {
        var code_lines = code.split("\n");
        var current_line = 0;
        var send_line = function() {
            if(current_line < lines.length) {
                _node_instance.send_data('file.write("' + lines[current_line++] + '\n")', send_line);
            } else {
                _node_instance.send_data('file.close()', completed_callback)
            }
        };

        _node_instance.send_data('file.open("' + filename + '", "w"),', send_line);
    };

    this.validate = function(found_callback) {
        function _found_wrapper() {
            found_callback(_node_instance);
        }

        function _timed_out() {
            output_console.writeLine("Timed out - not running NodeMCU");
            _node_instance.disconnect();
        }

        // Validate by attempting a connection
        output_console.writeLine("Attempting connection");
        this.connect(function() {
            output_console.writeLine("Connected");
            // We need two events here:
            // - A timeout - it didn't respond confirming - disconnect the port.
            var timeout = new goog.async.Delay(_timed_out, 2000);
            timeout.start();
            // - A receive - the node response confirms it - cancel the timeout.
            _node_instance.addLineEventListener(function(e) {
                if(goog.string.contains(e.detail.line, 'node mcu confirmed')) {
                    output_console.writeLine("Confirmed - NodeMCU found");
                    _node_instance.disconnect(_found_wrapper);
                    timeout.stop();
                }
            });
            output_console.writeLine("Sending confirmation test");
            _node_instance.send_data("print('node mcu confirmed')\n");
        });
    };
};

/**
 * Scan for NodeMCU boards connected
 *
 * @param found_callback Called when it's found with the Serial path.
 * @param console - output goes here.
 */
bounce.Nodemcu.scan = function(console, found_callback) {
    console.writeLine("Starting scan...");
    var onGetDevices = function(ports) {
        for (var i = 0; i < ports.length; i++) {
            console.writeLine('Found serial port ' + ports[i].path + '. Testing...');
            var mcu = new bounce.Nodemcu(ports[i].path, console);
            mcu.validate(found_callback);
        }
    };

    chrome.serial.getDevices(onGetDevices);
};
