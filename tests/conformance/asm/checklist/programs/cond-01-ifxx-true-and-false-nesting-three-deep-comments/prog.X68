	ORG $1000
	IFEQ 0
	DC.B 1
	ENDC
	IFNE 0
	DC.B 2
* listed comment
	IFEQ 0
	DC.B 3
	IFEQ 0
	DC.B 4
	ENDC
	ENDC
	DC.B 5
	ENDC
	IFLT -1
	DC.B 6
	ENDC
	IFLE 1
	DC.B 7
	ENDC
	IFGT 1
	DC.B 8
	ENDC
	IFGE -1
	DC.B 9
	ENDC
	IFC ABC,abc
	DC.B 10
	ENDC
	IFNC A,B
	DC.B 11
	ENDC
	END $1000
