/*
const EventEmitter = require('events');
const dgram = require('dgram');
const os = require('os');
const crypto = require('crypto');
const assert = require('assert');
*/

import { createCipheriv, createDecipheriv } from "crypto";
import { createSocket, RemoteInfo, Socket } from "dgram";
import EventEmitter from "events";
import { NetworkInterfaceInfo, networkInterfaces } from "os";

// RM Devices (without RF support)
const rmDeviceTypes: { [index: number]: string } = {};
rmDeviceTypes[0x2737] = "Broadlink RM Mini";
rmDeviceTypes[0x27c7] = 'Broadlink RM Mini 3 A';
rmDeviceTypes[0x27c2] = "Broadlink RM Mini 3 B";
rmDeviceTypes[0x27de] = "Broadlink RM Mini 3 C";
rmDeviceTypes[0x5f36] = "Broadlink RM Mini 3 D";
rmDeviceTypes[0x273d] = 'Broadlink RM Pro Phicomm';
rmDeviceTypes[0x2712] = 'Broadlink RM2';
rmDeviceTypes[0x2783] = 'Broadlink RM2 Home Plus';
rmDeviceTypes[0x277c] = 'Broadlink RM2 Home Plus GDT';
rmDeviceTypes[0x278f] = 'Broadlink RM Mini Shate';

// RM Devices (with RF support)
const rmPlusDeviceTypes: { [index: number]: string } = {};
rmPlusDeviceTypes[0x272a] = 'Broadlink RM2 Pro Plus';
rmPlusDeviceTypes[0x2787] = 'Broadlink RM2 Pro Plus v2';
rmPlusDeviceTypes[0x278b] = 'Broadlink RM2 Pro Plus BL';
rmPlusDeviceTypes[0x2797] = 'Broadlink RM2 Pro Plus HYC';
rmPlusDeviceTypes[0x27a1] = 'Broadlink RM2 Pro Plus R1';
rmPlusDeviceTypes[0x27a6] = 'Broadlink RM2 Pro PP';
rmPlusDeviceTypes[0x279d] = 'Broadlink RM3 Pro Plus';
rmPlusDeviceTypes[0x27a9] = 'Broadlink RM3 Pro Plus v2'; // (model RM 3422)
rmPlusDeviceTypes[0x27c3] = 'Broadlink RM3 Pro';

// Known Unsupported Devices
const unsupportedDeviceTypes: { [index: number]: string } = {};
unsupportedDeviceTypes[0] = 'Broadlink SP1';
unsupportedDeviceTypes[0x2711] = 'Broadlink SP2';
unsupportedDeviceTypes[0x2719] = 'Honeywell SP2';
unsupportedDeviceTypes[0x7919] = 'Honeywell SP2';
unsupportedDeviceTypes[0x271a] = 'Honeywell SP2';
unsupportedDeviceTypes[0x791a] = 'Honeywell SP2';
unsupportedDeviceTypes[0x2733] = 'OEM Branded SP Mini';
unsupportedDeviceTypes[0x273e] = 'OEM Branded SP Mini';
unsupportedDeviceTypes[0x2720] = 'Broadlink SP Mini';
unsupportedDeviceTypes[0x7d07] = 'Broadlink SP Mini';
unsupportedDeviceTypes[0x753e] = 'Broadlink SP 3';
unsupportedDeviceTypes[0x2728] = 'Broadlink SPMini 2';
unsupportedDeviceTypes[0x2736] = 'Broadlink SPMini Plus';
unsupportedDeviceTypes[0x2714] = 'Broadlink A1';
unsupportedDeviceTypes[0x4EB5] = 'Broadlink MP1';
unsupportedDeviceTypes[0x2722] = 'Broadlink S1 (SmartOne Alarm Kit)';
unsupportedDeviceTypes[0x4E4D] = 'Dooya DT360E (DOOYA_CURTAIN_V2) or Hysen Heating Controller';
unsupportedDeviceTypes[0x4ead] = 'Dooya DT360E (DOOYA_CURTAIN_V2) or Hysen Heating Controller';
unsupportedDeviceTypes[0x947a] = 'BroadLink Outlet';


export class Broadlink extends EventEmitter {

	private devices: { [index: string]: BroadlinkDevice };
	private sockets: Socket[];

	constructor() {
		super();

		this.devices = {};
		this.sockets = [];
	}

	/**
	 * Look for supported devices on the local network
	 */
	discover() {
		// Close existing sockets
		this.sockets.forEach((socket) => {
			socket.close();
		});

		this.sockets = [];

		// Open a UDP socket on each network interface/IP address
		let ipAddresses = this.getIPAddresses();

		ipAddresses.forEach((ipAddress) => {
			let socket = createSocket({ type: 'udp4', reuseAddr: true });
			this.sockets.push(socket);

			socket.on('listening', () => {
				this.onListening(socket, ipAddress);
			});

			socket.on('message', (buffer, rinfo) => {
				this.onMessage(buffer, rinfo);
			});

			socket.bind(0, ipAddress);
		});
	}

	/**
	 * Gets all non-internal IPV4 addresses
	 * 
	 * @returns List of IP addresses
	 */
	private getIPAddresses(): string[] {
		let interfaces = networkInterfaces();
		let ipAddresses: string[] = [];

		Object.keys(interfaces).forEach((key) => {
			let netwrokInterface = interfaces[key] as NetworkInterfaceInfo[];

			netwrokInterface.forEach((address) => {
				if (address.family === 'IPv4' && !address.internal) {
					ipAddresses.push(address.address);
				}
			});
		});

		return ipAddresses;
	}

	private onListening(socket: Socket, ipAddress: string) {

		// Broadcase a multicast UDP message to let Broadlink devices know we're listening
		socket.setBroadcast(true);

		let splitIPAddress = ipAddress.split('.');
		const port = socket.address().port;
		log(`Listening for Broadlink devices on ${ipAddress}:${port} (UDP)`);

		let now = new Date();
		let starttime = now.getTime();

		let timezone = now.getTimezoneOffset() / -3600;
		let packet = Buffer.alloc(0x30, 0);

		let year = now.getFullYear() - 1900;

		if (timezone < 0) {
			packet[0x08] = 0xff + timezone - 1;
			packet[0x09] = 0xff;
			packet[0x0a] = 0xff;
			packet[0x0b] = 0xff;
		} else {
			packet[0x08] = timezone;
			packet[0x09] = 0;
			packet[0x0a] = 0;
			packet[0x0b] = 0;
		}

		packet[0x0c] = year & 0xff;
		packet[0x0d] = year >> 8;
		packet[0x0e] = now.getMinutes();
		packet[0x0f] = now.getHours();

		let subyear = year % 100;
		packet[0x10] = subyear;
		packet[0x11] = now.getDay();
		packet[0x12] = now.getDate();
		packet[0x13] = now.getMonth();
		packet[0x18] = parseInt(splitIPAddress[0]);
		packet[0x19] = parseInt(splitIPAddress[1]);
		packet[0x1a] = parseInt(splitIPAddress[2]);
		packet[0x1b] = parseInt(splitIPAddress[3]);
		packet[0x1c] = port & 0xff;
		packet[0x1d] = port >> 8;
		packet[0x26] = 6;

		let checksum = 0xbeaf;

		for (let i = 0; i < packet.length; i++) {
			checksum += packet[i];
		}

		checksum = checksum & 0xffff;
		packet[0x20] = checksum & 0xff;
		packet[0x21] = checksum >> 8;

		socket.send(packet, 0, packet.length, 80, '255.255.255.255');
	}

	private onMessage(message: Buffer, host: RemoteInfo) {
		// Broadlink device has responded
		const macAddressBuffer = Buffer.alloc(6, 0);

		message.copy(macAddressBuffer, 0x00, 0x3D);
		message.copy(macAddressBuffer, 0x01, 0x3E);
		message.copy(macAddressBuffer, 0x02, 0x3F);
		message.copy(macAddressBuffer, 0x03, 0x3C);
		message.copy(macAddressBuffer, 0x04, 0x3B);
		message.copy(macAddressBuffer, 0x05, 0x3A);

		// Ignore if we already know about this device
		let macAddress = macAddressBuffer.toString('hex');
		if (this.devices[macAddress]) return;

		let deviceType = message[0x34] | (message[0x35] << 8);

		log(`Discovered Broadlink device with MAC address ${macAddress} and type ${deviceType}`);

		// Create a Device instance
		this.addDevice(host, macAddressBuffer, deviceType);
	}


	addDevice(host: RemoteInfo, mac: Buffer, deviceType: number) {

		// If the device has already been added, ignore it
		if (this.devices[mac.toString('hex')]) return;

		// Ignore devices that don't support infrared or RF.
		if (unsupportedDeviceTypes[deviceType] !== undefined) {
			(`Ignoring unsupported device type ${unsupportedDeviceTypes[deviceType]} at ${host.address}:${host.port}`);
			return;
		}
		// Ignore OEM branded SPMini2
		if (deviceType >= 0x7530 && deviceType <= 0x7918) {
			log(`Ignoring unsupported device type ${deviceType} at ${host.address}:${host.port}`);
			return;
		}

		// Ignore unknown device types
		if (rmDeviceTypes[deviceType] == undefined && rmPlusDeviceTypes[deviceType] == undefined) {
			log(`Ignoring unknown device type ${deviceType.toString(16)} at ${host.address}:${host.port}`);
			return;
		}

		let device = new BroadlinkDevice(host, mac, deviceType);
		this.devices[mac.toString('hex')] = device;

		log(`Found ${device.model} at ${host.address}:${host.port}`);

		// Authenticate the device and let others know when it's ready.
		device.on('deviceReady', () => {
			this.emit('deviceReady', device);
		});

		device.authenticate();
	}

	// Event overloads with typed listener signatures
	on(event: 'deviceReady', listener: (device: BroadlinkDevice) => void): this;
	on(event: string | symbol, listener: (...args: any[]) => void): this;
	on(event: string | symbol, listener: (...args: any[]) => void): this {
		return super.on(event, listener);
	}
}

export enum DeviceCapabilites {
	RF = 'RF'
}

export class BroadlinkDevice extends EventEmitter {

	readonly host: RemoteInfo;
	readonly mac: Buffer;
	readonly type: number;
	readonly model: string;
	readonly socket: Socket;
	count: number;

	private sweepHandler?: Promise<void>;
	private confirmHandler?: Promise<Buffer>;

	key: Buffer;
	iv: Buffer;
	id: Buffer;

	readonly capabilites: { [key in DeviceCapabilites]: boolean };

	constructor(host: RemoteInfo, mac: Buffer, type: number) {
		super();
		this.host = host;
		this.mac = mac;

		this.type = type;
		this.model = rmDeviceTypes[type] || rmPlusDeviceTypes[type];

		this.socket = createSocket({ type: 'udp4', reuseAddr: true });

		this.count = Math.random() & 0xffff;
		this.key = Buffer.from([0x09, 0x76, 0x28, 0x34, 0x3f, 0xe9, 0x9e, 0x23, 0x76, 0x5c, 0x15, 0x13, 0xac, 0xcf, 0x8b, 0x02]);
		this.iv = Buffer.from([0x56, 0x2e, 0x17, 0x99, 0x6d, 0x09, 0x3d, 0x28, 0xdd, 0xb3, 0xba, 0x69, 0x5a, 0x2e, 0x6f, 0x58]);
		this.id = Buffer.from([0, 0, 0, 0]);

		this.listen();

		this.capabilites = {
			[DeviceCapabilites.RF]: rmPlusDeviceTypes[type] !== undefined
		};
	}


	/**
	 * Start listening on the device socket
	 */
	private listen() {

		this.socket.on('message', (response) => {
			let encryptedPayload = Buffer.alloc(response.length - 0x38, 0);
			response.copy(encryptedPayload, 0, 0x38);

			let err = response[0x22] | (response[0x23] << 8);
			if (err != 0) {
				this.emit('data-error', err);
				return;
			};

			let decipher = createDecipheriv('aes-128-cbc', this.key, this.iv);
			decipher.setAutoPadding(false);

			let payload = decipher.update(encryptedPayload);

			let p2 = decipher.final();
			if (p2) payload = Buffer.concat([payload, p2]);

			if (!payload) return false;

			let command = response[0x26];

			if (command == 0xe9) {
				this.key = Buffer.alloc(0x10, 0);
				payload.copy(this.key, 0, 0x04, 0x14);

				this.id = Buffer.alloc(0x04, 0);
				payload.copy(this.id, 0, 0x00, 0x04);

				this.emit('deviceReady', this);
			} else if (command == 0xee || command == 0xef) {
				this.onPayloadReceived(err, payload);
			} else {
				log(`Unknown command received: 0x${command.toString(16)}`);
			}
		});

		this.socket.bind();
	}


	authenticate() {
		let payload = Buffer.alloc(0x50, 0);

		payload[0x04] = 0x31;
		payload[0x05] = 0x31;
		payload[0x06] = 0x31;
		payload[0x07] = 0x31;
		payload[0x08] = 0x31;
		payload[0x09] = 0x31;
		payload[0x0a] = 0x31;
		payload[0x0b] = 0x31;
		payload[0x0c] = 0x31;
		payload[0x0d] = 0x31;
		payload[0x0e] = 0x31;
		payload[0x0f] = 0x31;
		payload[0x10] = 0x31;
		payload[0x11] = 0x31;
		payload[0x12] = 0x31;
		payload[0x1e] = 0x01;
		payload[0x2d] = 0x01;
		payload[0x30] = 'T'.charCodeAt(0);
		payload[0x31] = 'e'.charCodeAt(0);
		payload[0x32] = 's'.charCodeAt(0);
		payload[0x33] = 't'.charCodeAt(0);
		payload[0x34] = ' '.charCodeAt(0);
		payload[0x35] = ' '.charCodeAt(0);
		payload[0x36] = '1'.charCodeAt(0);

		this.sendPacket(0x65, payload);
	}

	sendPacket(command: number, payload: Buffer) {
		this.count = (this.count + 1) & 0xffff;

		let packet = Buffer.alloc(0x38, 0);

		packet[0x00] = 0x5a;
		packet[0x01] = 0xa5;
		packet[0x02] = 0xaa;
		packet[0x03] = 0x55;
		packet[0x04] = 0x5a;
		packet[0x05] = 0xa5;
		packet[0x06] = 0xaa;
		packet[0x07] = 0x55;
		packet[0x24] = 0x2a;
		packet[0x25] = 0x27;
		packet[0x26] = command;
		packet[0x28] = this.count & 0xff;
		packet[0x29] = this.count >> 8;
		packet[0x2a] = this.mac[5];
		packet[0x2b] = this.mac[4];
		packet[0x2c] = this.mac[3];
		packet[0x2d] = this.mac[2];
		packet[0x2e] = this.mac[1];
		packet[0x2f] = this.mac[0];
		packet[0x30] = this.id[0];
		packet[0x31] = this.id[1];
		packet[0x32] = this.id[2];
		packet[0x33] = this.id[3];

		let checksum = 0xbeaf;
		for (let i = 0; i < payload.length; i++) {
			checksum += payload[i];
			checksum = checksum & 0xffff;
		}

		let cipher = createCipheriv('aes-128-cbc', this.key, this.iv);
		payload = cipher.update(payload);

		packet[0x34] = checksum & 0xff;
		packet[0x35] = checksum >> 8;

		packet = Buffer.concat([packet, payload]);

		checksum = 0xbeaf;
		for (let i = 0; i < packet.length; i++) {
			checksum += packet[i];
			checksum = checksum & 0xffff;
		}
		packet[0x20] = checksum & 0xff;
		packet[0x21] = checksum >> 8;

		//if (debug) log('\x1b[33m[DEBUG]\x1b[0m packet', packet.toString('hex'))

		this.socket.send(packet, 0, packet.length, this.host.port, this.host.address, (err, bytes) => {
			//if (debug && err) log('\x1b[33m[DEBUG]\x1b[0m send packet error', err)
			//if (debug) log('\x1b[33m[DEBUG]\x1b[0m successfuly sent packet - bytes: ', bytes)
		});
	}

	private onPayloadReceived(err: number, payload: Buffer) {
		let param = payload[0];

		let data = Buffer.alloc(payload.length - 4, 0);
		payload.copy(data, 0, 4);

		switch (param) {
			case 1: {
				let temp = (payload[0x4] * 10 + payload[0x5]) / 10.0;
				this.emit('temperature', temp);
				break;
			}
			case 4: { //get from check_data
				let data = Buffer.alloc(payload.length - 4, 0);
				payload.copy(data, 0, 4);
				this.emit('data', data);
				break;
			}
			case 26: { //get from check_data
				let data = Buffer.alloc(1, 0);
				payload.copy(data, 0, 0x4);
				this.emit('sweep', data[0] === 1);
				break;
			}
			case 27: { //get from check_data
				let data = Buffer.alloc(1, 0);
				payload.copy(data, 0, 0x4);
				this.emit('rf-data', data);
				break;
			}
		}
	}

	// Externally Accessed Methods

	checkData() {
		const packet = Buffer.alloc(16, 0);
		packet[0] = 4;
		this.sendPacket(0x6a, packet);
	}

	sendData(data: Buffer) {
		let packet = Buffer.from([0x02, 0x00, 0x00, 0x00]);
		packet = Buffer.concat([packet, data]);
		this.sendPacket(0x6a, packet);
	}

	enterLearning() {
		let packet = Buffer.alloc(16, 0);
		packet[0] = 3;
		this.sendPacket(0x6a, packet);
	}

	checkTemperature() {
		let packet = Buffer.alloc(16, 0);
		packet[0] = 1;
		this.sendPacket(0x6a, packet);
	}

	cancelLearn() {
		let packet = Buffer.alloc(16, 0);
		packet[0] = 0x1e;
		this.sendPacket(0x6a, packet);
	}


	/**
	 * High level, asynchronous RF sweep. During RF sweep you have 10 seconds to long press the button 
	 * which the RM device needs to learn. If the sweep is successful, you can call the high level function
	 * confirmFrequency() to get the learnt RF data for the button.
	 * 
	 * @returns A promise, which resolves if the RF sweep was successful. IF the sweep was not successful,
	 * or the sweep does not yield any result within the allowed timeout, the promise rejects.
	 */
	sweepFrequency(): Promise<void> {
		if (this.sweepHandler !== undefined)
			return this.sweepHandler;
		this.sweepHandler = new Promise<void>((resolve, reject) => {

			// Make sure we wrap up if sweep does not do anything
			let sweepTimeout = setTimeout(() => {
				this.cancelRFSweep();
				this.sweepHandler = undefined;
				reject('RF sweep did not return any result');
			}, 30000);
			// In 10 seconds we will send a command to check if sweep was successful
			setTimeout(() => {
				this.checkRFSweep();
			}, 10000);
			this.on('sweep', (success) => {
				clearTimeout(sweepTimeout);
				this.sweepHandler = undefined;
				if (!success) {
					reject('The RF sweep was not successful')
				}
				else {
					resolve();
				}
			});

			this.enterRFSweep();
		});

		return this.sweepHandler;
	}

	/**
	 * High level, asynchronous method to confirm the RF data for the button which the device need to learn.
	 * This method must be called after a previous sweepFrequency() call resolved successfully.
	 * 
	 * Calling this method will put the device in listening mode again, during which time you must short press
	 * the same button as the one you used in sweepFrequency()
	 * 
	 * @returns A promise, which resolves to a buffer of the isolated button data
	 */
	confirmFrequency(): Promise<Buffer> {
		if (this.confirmHandler !== undefined)
			return this.confirmHandler;
		this.confirmHandler = new Promise<Buffer>((resolve, reject) => {
			let dataTimeout = setTimeout(() => {
				this.confirmHandler = undefined;
				reject('Did not get RF data from device');
			}, 10000);
			setTimeout(() => {
				this.checkData();
			}, 5000);
			this.on('data', (buf) => {
				clearTimeout(dataTimeout);
				this.confirmHandler = undefined;
				resolve(buf);
			});
			this.findRFPacket();
		});
		return this.confirmHandler;
	}

	/** 
	 * Enter RF sweep mode. While in RF sweep mode, you must
	 * long press the button you want the device to learn. This mode is also indicated on the RM unit with a 
	 * red or blinking LED.
	 */
	enterRFSweep() {
		if (!this.capabilites[DeviceCapabilites.RF]) {
			log('This device does not have RF capabilities');
			return;
		}
		log('When the LED indicator is on, long press the button on the remote');
		let packet = Buffer.alloc(16, 0);
		packet[0] = 0x19;
		this.sendPacket(0x6a, packet);
	}

	/**
	 * Cancels an ongoing RF sweep mode.
	 */
	cancelRFSweep() {
		if (!this.capabilites[DeviceCapabilites.RF]) {
			log('This device does not have RF capabilities');
			return;
		}
		let packet = Buffer.alloc(16, 0);
		packet[0] = 0x1e;
		this.sendPacket(0x6a, packet);
	}

	/**
	 * Check if an RF packet can be isolated form the RF sweep results. This puts the device in listening mode,
	 * during which time you must short press the button again.
	 * 
	 * After the short press, you must call checkData() to check for the captured RF data	 
	 */
	findRFPacket() {
		if (!this.capabilites[DeviceCapabilites.RF]) {
			log('This device does not have RF capabilities');
			return;
		}
		log('Now, short press the same button');
		let packet = Buffer.alloc(16, 0);
		packet[0] = 0x1b;
		this.sendPacket(0x6a, packet);
	}

	/**
	 * Check if the previous RF sweep was successful. You must attach a listener to 'sweep' event to get the results.
	 */
	checkRFSweep() {
		if (!this.capabilites[DeviceCapabilites.RF]) {
			log('This device does not have RF capabilities');
			return;
		}
		let packet = Buffer.alloc(16, 0);
		packet[0] = 0x1a;
		this.sendPacket(0x6a, packet);
	}

	// Event overloads with typed listener signatures
	on(event: 'deviceReady', listener: (device: BroadlinkDevice) => void): this;
	on(event: 'temperature', listener: (temperature: number) => void): this;
	on(event: 'data', listener: (data: Buffer) => void): this;
	on(event: 'sweep', listener: (success: boolean) => void): this;
	on(event: 'rf-data', listener: (data: Buffer) => void): this;
	on(event: string | symbol, listener: (...args: any[]) => void): this;
	on(event: string | symbol, listener: (...args: any[]) => void): this {
		return super.on(event, listener);
	}
}

/**
	 * Print a fomratted log message.
	 * 
	 * @param str The message to be displayed
	 * @param component Optionally the message can be tagged with a component name or class name
	 */
function log(str: string, component: string | object | undefined = undefined): void {
	let tag: string = '';
	if (typeof component === 'string')
		tag = ` \x1b[32m[${component}]`;
	if (typeof component === 'object')
		tag = ` \x1b[32m[${component.constructor.name}]`;
	console.log(`\x1b[36m[${new Date().toISOString()}]${tag}\x1b[0m ${str}`);
}