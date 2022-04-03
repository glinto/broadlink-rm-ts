# broadlink-rm-ts
A typescript library for interacting with Broadlink universal remote devices. This library is large based on (ported from)
other libs listed in the "Thanks" section.

## Installation

You can obtain the package from npm.

```
$ npm install broadlink-rm-ts
```

## Setting up a Broadlink device

```typescript
import { Broadlink } from "broadlink-rm-ts";
let broadlink = new Broadlink();

broadlink.on('deviceReady', (device) => {
	console.log('Device ready!');
});

broadlink.discover();
```

## Learning RF codes

One of the clunkiest methods of the RM pro remotes is the way they learn RF remote buttons. To make it easy to use, 
I have wrapped the whole TCP data back and forth business in two convenient async calls:

- sweepFrequency(): enter the device in RF sweep mode (10 seconds), during which mode you long press the button you want to teach
- confirmFrequency(): enter the device in RF learning mode, during which mode you short press the same button again

Both methods return promises, you can easily chain them together. Check out the simple example below:

```typescript
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
```

## Thanks
- [https://github.com/lprhodes/broadlinkjs-rm] - for the original Javascript port
- [https://github.com/mjg59/python-broadlink] - for the broadlink Python library
