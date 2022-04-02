import { Broadlink } from "..";

let broadlink = new Broadlink();

broadlink.on('deviceReady', (device) => {
	device.sweepFrequency()
		.then(() => device.confirmFrequency())
		.then((buf) => {
			console.log('RF code', buf.toString('hex'));
		})
		.catch((reason) => console.log)
});

broadlink.discover();


